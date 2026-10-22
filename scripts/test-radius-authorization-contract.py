"""Offline authorization/chain protocol expectations; NOT real DB/HTTP guarantees.

Test-only dependency: jsonschema==4.25.1. Authorization policy is disabled by
default even in this model; positive ordering fixtures opt into a hypothetical
technical model, not owner acceptance or a production feature switch.
"""
from copy import deepcopy
import importlib.util
import json
from pathlib import Path
import unittest

from jsonschema import Draft202012Validator, FormatChecker
from referencing import Resource

spec = importlib.util.spec_from_file_location("caf_round2_contract", Path(__file__).with_name("test-radius-round2-contract.py"))
round2 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(round2)
ROOT = round2.ROOT
SCHEMA = round2.load(ROOT / "activation-authorization.proposed.schema.json")
DIRECTORY = round2.load(ROOT / "directory.proposed.schema.json")
REGISTRY = round2.REGISTRY.with_resources((s["$id"], Resource.from_contents(s)) for s in (SCHEMA, DIRECTORY))


def fixture(name):
    return round2.load(ROOT / "examples/authorization" / (name + ".example.json"))


def validate(definition, data):
    Draft202012Validator({"$ref": SCHEMA["$id"] + "#/$defs/" + definition}, registry=REGISTRY, format_checker=FormatChecker()).validate(data)


def require(condition, code):
    round2.require(condition, code)


def request_semantics(request):
    validate("authorizationRequest", request)
    require(request["approval_ref"]["approval_id"] == request["provisioning_ref"]["event_id"], "approval_receipt_mismatch")
    if request["provisioning_ref"]["operation"] == "provisionings-v1":
        require(request["provisioning_ref"]["request_id"] == request["provisioning_ref"]["event_id"], "v1_receipt_namespace")


def decision_semantics(decision):
    validate("authorizationDecision", decision)
    request_semantics(decision["request"])
    require(decision["activation_attempt_id"] == decision["request"]["activation_attempt_id"], "attempt_mismatch")


class AuthorizationModel:
    """Single-process fixture model; real handlers need transactional locks/outbox."""
    def __init__(self):
        self.request = fixture("request")
        self.state = "APPROVED"
        self.sequence = 10
        self.credential_confirmed = True
        self.decisions = {}
        self.granted = False

    def withdraw(self):
        self.sequence += 1
        self.state = "WITHDRAWN"

    def authorize(self, request, policy_enabled=False):
        require(policy_enabled, "activation_policy_not_configured")
        request_semantics(request)
        attempt = request["activation_attempt_id"]
        if attempt in self.decisions:
            prior_request, prior_decision = self.decisions[attempt]
            require(prior_request == request, "replay_conflict")
            return deepcopy(prior_decision)
        # Source is actually derived from backend authentication at runtime.
        # Fixture equality here describes expected scope, not token verification.
        for field in ("source_id", "customer_id", "service_request_id", "radius_company_id", "radius_franchise_id", "radius_service_id"):
            require(request[field] == self.request[field], "binding_conflict")
        for field in ("company_ref", "franchise_ref"):
            require(request[field]["id"] == self.request[field]["id"], "binding_conflict")
        require(not self.granted, "authorization_epoch_already_granted")
        reason = "approved"
        if self.state == "WITHDRAWN":
            reason = "approval_withdrawn"
        elif request["approval_ref"] != self.request["approval_ref"]:
            reason = "stale_approval"
        elif not self.credential_confirmed or request["provisioning_ref"] != self.request["provisioning_ref"]:
            reason = "credential_acceptance_unconfirmed"
        self.sequence += 1
        result = fixture("authorized")
        result.update(activation_attempt_id=attempt, request=deepcopy(request), authority_sequence=self.sequence, decision="authorized" if reason == "approved" else "denied", reason_code=reason)
        self.granted = reason == "approved"
        self.decisions[attempt] = (deepcopy(request), deepcopy(result))
        return result


def can_enable(decision, known_withdrawal_sequence=None, policy_enabled=False):
    decision_semantics(decision)
    return policy_enabled and decision["decision"] == "authorized" and not (
        known_withdrawal_sequence is not None and known_withdrawal_sequence > decision["authority_sequence"])


def identity_projection(event):
    return {"customer_id": event["customer_id"], "company_id": event["company_ref"]["id"], "franchise_id": event["franchise_ref"]["id"],
            "profile": {"name": event["profile"]["name"], "mobile": event["profile"].get("mobile"), "email": event["profile"].get("email")}}


def replace_leaf(nodes, leaf, parent_id, successor_id, accepted_in_any_namespace=False, keys=("k1",), new_plan_version=7, binding_fingerprint="synthetic-keyed-binding-fingerprint"):
    require(not accepted_in_any_namespace, "already_accepted")
    require(successor_id != parent_id, "self_supersession")
    require(successor_id not in nodes, "cycle_or_existing_request")
    require(parent_id == leaf and parent_id in nodes, "not_current_leaf")
    seen, cursor = set(), parent_id
    while cursor is not None:
        require(cursor not in seen, "chain_cycle")
        seen.add(cursor)
        require(cursor in nodes, "unknown_predecessor")
        cursor = nodes[cursor]["parent"]
    parent = nodes[parent_id]
    require(parent["operation"] == "provisionings-v2", "cross_version_parent_unsupported")
    require(parent["successor"] is None, "replacement_fork")
    require(not any(n["accepted"] for n in nodes.values()), "already_accepted")
    require(parent["failure"] == "reservation_expired", "predecessor_not_expired")
    require(parent["key_id"] in keys, "fingerprint_key_unavailable")
    require(parent["plan_version"] == new_plan_version and parent["binding_fingerprint"] == binding_fingerprint, "binding_conflict")
    # Opaque synthetic HMAC references only; no cryptographic implementation here.
    result = deepcopy(nodes)
    result[parent_id]["successor"] = successor_id
    result[successor_id] = dict(parent=parent_id, successor=None, operation="provisionings-v2", accepted=True, failure=None,
                                key_id=parent["key_id"], plan_version=new_plan_version, binding_fingerprint=binding_fingerprint)
    return result


class AuthorizationContractTests(unittest.TestCase):
    def test_schema_positive_fixtures_and_unchanged_directory_shapes(self):
        for schema in (SCHEMA, DIRECTORY):
            Draft202012Validator.check_schema(schema)
        for name, definition in (("request", "authorizationRequest"), ("authorized", "authorizationDecision"), ("denied-after-withdrawal", "authorizationDecision"),
                                 ("withdrawal-after-authorization", "withdrawalMarker"), ("withdrawal-before-authorization", "withdrawalMarker"), ("retention", "retentionProposal")):
            validate(definition, fixture(name))
        for name, definition in DIRECTORY["$defs"].items():
            self.assertEqual(definition, round2.READ["$defs"][name])
        self.assertEqual(len(fixture("ordering-cases")), 4)

    def test_authorization_is_gated_by_default(self):
        with self.assertRaisesRegex(ValueError, "^activation_policy_not_configured$"):
            AuthorizationModel().authorize(fixture("request"))
        self.assertFalse(can_enable(fixture("authorized")))

    def test_withdrawal_first_denies_and_never_enables(self):
        model = AuthorizationModel()
        model.withdraw()
        decision = model.authorize(fixture("request"), policy_enabled=True)
        self.assertEqual(decision["decision"], "denied")
        self.assertEqual(decision["reason_code"], "approval_withdrawn")
        self.assertFalse(can_enable(decision, policy_enabled=True))

    def test_grant_first_is_immutable_but_known_later_withdrawal_blocks(self):
        model = AuthorizationModel()
        first = model.authorize(fixture("request"), policy_enabled=True)
        model.withdraw()
        self.assertEqual(model.authorize(fixture("request"), policy_enabled=True), first)
        self.assertFalse(can_enable(first, known_withdrawal_sequence=model.sequence, policy_enabled=True))

    def test_unknown_later_withdrawal_exposes_product_decision_not_strict_fence(self):
        model = AuthorizationModel()
        grant = model.authorize(fixture("request"), policy_enabled=True)
        model.withdraw()
        # Counterexample: under a hypothetical accepted logical-point policy,
        # an undelivered withdrawal is not known to the independent Radius DB.
        self.assertTrue(can_enable(grant, known_withdrawal_sequence=None, policy_enabled=True))
        self.assertFalse(can_enable(grant, known_withdrawal_sequence=None))

    def test_retry_conflict_and_distinct_attempt_cannot_duplicate_grant(self):
        model, request = AuthorizationModel(), fixture("request")
        model.authorize(request, policy_enabled=True)
        changed = deepcopy(request)
        changed["radius_service_id"] = "c7f496c8-4ff8-4fae-bf57-74b76931afef"
        with self.assertRaisesRegex(ValueError, "^replay_conflict$"):
            model.authorize(changed, policy_enabled=True)
        changed = deepcopy(request)
        changed["activation_attempt_id"] = "c7f496c8-4ff8-4fae-bf57-74b76931afef"
        with self.assertRaisesRegex(ValueError, "^authorization_epoch_already_granted$"):
            model.authorize(changed, policy_enabled=True)

    def test_unconfirmed_credentials_and_stale_approval_deny(self):
        model = AuthorizationModel()
        model.credential_confirmed = False
        self.assertEqual(model.authorize(fixture("request"), policy_enabled=True)["reason_code"], "credential_acceptance_unconfirmed")
        changed = fixture("request")
        changed["approval_ref"]["approval_version"] = 2
        self.assertEqual(AuthorizationModel().authorize(changed, policy_enabled=True)["reason_code"], "stale_approval")

    def test_nested_receipt_attempt_and_scope_bindings(self):
        invalid = fixture("authorized")
        invalid["activation_attempt_id"] = "c7f496c8-4ff8-4fae-bf57-74b76931afef"
        with self.assertRaisesRegex(ValueError, "^attempt_mismatch$"):
            decision_semantics(invalid)
        invalid = fixture("request")
        invalid["provisioning_ref"]["operation"] = "provisionings-v1"
        with self.assertRaisesRegex(ValueError, "^v1_receipt_namespace$"):
            request_semantics(invalid)
        for field in ("source_id", "customer_id", "radius_company_id", "radius_franchise_id"):
            invalid = fixture("request")
            invalid[field] = "1000000999" if field == "customer_id" else "other-binding"
            with self.assertRaisesRegex(ValueError, "^binding_conflict$"):
                AuthorizationModel().authorize(invalid, policy_enabled=True)

    def test_no_credentials_or_identity_documents_in_authorization(self):
        for field in ("password", "initial_password", "idNumber", "documents", "profile", "nas_secret"):
            invalid = fixture("request")
            invalid[field] = "DO-NOT-SEND"
            with self.assertRaises(Exception):
                validate("authorizationRequest", invalid)

    def test_profile_equivalence_normalization_does_not_change_replay_payload(self):
        first = deepcopy(round2.fixture("approval-a")["approval_event"])
        second = deepcopy(first)
        del second["profile"]["mobile"]
        del second["profile"]["email"]
        second["company_ref"]["code"] = "DISPLAY-CHANGED"
        self.assertEqual(identity_projection(first), identity_projection(second))
        self.assertNotEqual(first, second)  # Full replay material remains different.
        second["profile"]["name"] += " "
        self.assertNotEqual(identity_projection(first), identity_projection(second))

    def test_chain_leaf_fork_cycle_namespace_key_and_plan_checks(self):
        node = dict(parent=None, successor=None, operation="provisionings-v2", accepted=False, failure="reservation_expired", key_id="k1", plan_version=7,
                    binding_fingerprint="synthetic-keyed-binding-fingerprint")
        initial = {"a": node}
        accepted = replace_leaf(initial, "a", "a", "b", keys=("k1", "k2"))
        self.assertTrue(accepted["b"]["accepted"])
        for options, code in ((dict(accepted_in_any_namespace=True), "already_accepted"), (dict(keys=("k2",)), "fingerprint_key_unavailable"),
                              (dict(new_plan_version=8), "binding_conflict"), (dict(binding_fingerprint="different-keyed-fingerprint"), "binding_conflict")):
            with self.assertRaisesRegex(ValueError, "^" + code + "$"):
                replace_leaf(initial, "a", "a", "b", **options)
        with self.assertRaisesRegex(ValueError, "^self_supersession$"):
            replace_leaf(initial, "a", "a", "a")
        with self.assertRaisesRegex(ValueError, "^not_current_leaf$"):
            replace_leaf(accepted, "b", "a", "c")
        with self.assertRaisesRegex(ValueError, "^cycle_or_existing_request$"):
            replace_leaf(accepted, "b", "b", "a")
        malformed = deepcopy(initial)
        malformed["a"]["parent"] = "a"
        with self.assertRaisesRegex(ValueError, "^chain_cycle$"):
            replace_leaf(malformed, "a", "a", "b")
        malformed = deepcopy(initial)
        malformed["a"]["successor"] = "unresolved-successor"
        with self.assertRaisesRegex(ValueError, "^replacement_fork$"):
            replace_leaf(malformed, "a", "a", "b")
        malformed = deepcopy(initial)
        malformed["a"]["operation"] = "provisionings-v1"
        with self.assertRaisesRegex(ValueError, "^cross_version_parent_unsupported$"):
            replace_leaf(malformed, "a", "a", "b")

    def test_cross_version_acceptance_tombstone_survives_receipt_archival(self):
        service = {"accepted": False, "credential_writes": 0, "service_id": None}
        receipts = {}
        for operation in ("v1", "v2"):
            if not service["accepted"]:
                service.update(accepted=True, credential_writes=1, service_id="one-stable-service")
            receipts[operation] = {"credential_accepted": service["accepted"], "service_id": service["service_id"]}
            receipts.clear()  # Archive receipts, NOT the durable service tombstone.
        self.assertEqual(service["credential_writes"], 1)
        self.assertEqual(service["service_id"], "one-stable-service")

    def test_credential_deadline_is_absolute_and_acceptance_purges_immediately(self):
        policy = fixture("retention")
        captured = 1000
        deadline = captured + policy["credential_ciphertext_window_seconds"]
        for retry_time in (captured + 5, captured + 100, deadline - 1):
            self.assertEqual(deadline, captured + 86400)
            self.assertLess(retry_time, deadline)
        self.assertFalse(policy["extend_credential_deadline_on_retry"])
        # Deliberately distinguish the expiry/unknown outcome from acceptance.
        states = [(True, captured + 10, "purge-accepted"), (False, deadline, "purge-and-reconcile-no-auto-reset"), (False, deadline - 1, "retain-until-absolute-deadline")]
        for accepted, now, expected in states:
            outcome = "purge-accepted" if accepted else ("purge-and-reconcile-no-auto-reset" if now >= deadline else "retain-until-absolute-deadline")
            self.assertEqual(outcome, expected)
        self.assertGreater(policy["feed_retention_seconds"], policy["snapshot_ttl_seconds"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
