"""Offline PROPOSED protocol/fixture checks, not application or RADIUS runtime tests.

Requires test-only jsonschema==4.25.1. No DB, HTTP requests or secrets are used.
Semantic helpers describe expectations for future implementations; they are not
production authorization, HMAC, activation fencing or retry code.
"""
from copy import deepcopy
import json
from pathlib import Path
import unittest

from jsonschema import Draft202012Validator, FormatChecker
from referencing import Registry, Resource

ROOT = Path(__file__).resolve().parents[1] / "docs/integrations/radius"
FIXTURES = ROOT / "examples/round2"


def load(path):
    return json.loads(path.read_text(encoding="utf-8"))


SCHEMA = load(ROOT / "round2.proposed.schema.json")
READ = load(ROOT / "caf-read-api.proposed.schema.json")
SCHEMAS = [SCHEMA, READ] + [load(ROOT / "reference" / name) for name in (
    "ecaf-event.schema.json", "ecaf-provisioning.schema.json")]
REGISTRY = Registry().with_resources((s["$id"], Resource.from_contents(s)) for s in SCHEMAS)


def validator(definition, schema=SCHEMA):
    return Draft202012Validator({"$ref": schema["$id"] + "#/$defs/" + definition}, registry=REGISTRY, format_checker=FormatChecker())


def fixture(name):
    return load(FIXTURES / (name + ".example.json"))


def require(condition, code):
    if not condition:
        raise ValueError(code)


def bindings(parent, child):
    require(parent["customer_id"] == child["customer_id"], "customer_binding")
    # Codes are diagnostic display values, not authorization identities.
    for entity in ("company", "franchise"):
        require(parent[entity + "_ref"]["id"] == child[entity + "_ref"]["id"], entity + "_binding")


def semantics(definition, data):
    validator(definition).validate(data)
    if definition == "customerMaster":
        if data["approved_profile"] is not None:
            approved = data["approved_profile"]
            bindings(data, approved)
            require(approved["profile_version"] <= data["customer_version"], "future_profile")
        if data["identity_review"] is not None:
            require(data["identity_review"]["base_profile_version"] <= data["customer_version"], "future_review_base")
    elif definition == "exactApproval":
        approved = data["approval_event"]
        bindings(data, approved)
        require(approved["customer_version"] <= data["customer_version"], "future_profile")
        require(approved["caf"]["application_id"] == data["application_id"], "exact_application")
        require(approved["caf"]["revision"] == data["revision"], "exact_revision")
        require(approved["event_id"] == data["approval_id"], "exact_approval")
        require(data["approval_version"] <= data["service_approval_version"], "future_service_approval")
        if data["approval_status"] == "APPROVED":
            require(data["approval_version"] == data["service_approval_version"], "stale_service_approval")
    elif definition == "bootstrapPage":
        for item in data["items"]:
            semantics("customerMaster" if item["resource_type"] == "customer" else "exactApproval", item["resource"])


def profile_advance(version, profile, event):
    projection = {"customer_id": event["customer_id"], "company_id": event["company_ref"]["id"], "franchise_id": event["franchise_ref"]["id"], "profile": event["profile"]}
    if event["customer_version"] < version:
        return version, profile
    if event["customer_version"] == version:
        require(profile == projection, "profile_version_conflict")
    return event["customer_version"], projection


def bootstrap_checkpoint(start, pages):
    validator("bootstrapStart").validate(start)
    for index, page in enumerate(pages):
        semantics("bootstrapPage", page)
        for field in ("snapshot_id", "expires_at", "continuation_cursor"):
            require(start[field] == page[field], "mixed_bootstrap_boundary")
        if index < len(pages) - 1:
            require(page["has_more"], "page_after_final")
    if not pages or pages[-1]["has_more"]:
        return None
    require(pages[-1]["next_cursor"] is None, "invalid_final_page")
    return start["continuation_cursor"]


def replacement_allowed(old, new, receipt, old_reservation, new_reservation):
    for request in (old, new):
        validator("provisioningRequestV2").validate(request)
    if receipt is None:
        raise ValueError("receipt_reconciliation_required")
    validator("provisioningReceiptV2").validate(receipt)
    require(receipt["credential_accepted"] is False, "replacement_not_allowed")
    require(receipt["receipt_status"] in ("blocked", "failed"), "receipt_reconciliation_required")
    require(receipt["error"] is not None and receipt["error"]["code"] == "reservation_expired", "replacement_not_allowed")
    require(receipt["provisioning_request_id"] == old["provisioning_request_id"], "wrong_predecessor")
    require(receipt["event_id"] == old["approval"]["event_id"], "wrong_predecessor")
    require(receipt["service_request_id"] == old["service"]["service_request_id"], "wrong_predecessor")
    bindings(receipt, old["approval"])
    require(new["supersedes_request_id"] == old["provisioning_request_id"], "wrong_predecessor")
    require(new["provisioning_request_id"] != old["provisioning_request_id"], "replay_conflict")
    require(new["approval"] == old["approval"], "replacement_binding_conflict")
    for field in ("service_request_id", "username", "plan_id", "initial_password"):
        # Synthetic fixture comparison only; production must use the agreed
        # server-keyed canonical HMAC and must never log values on conflict.
        require(new["service"][field] == old["service"][field], "replacement_binding_conflict")
    for reservation in (old_reservation, new_reservation):
        validator("reservation").validate(reservation)
        bindings(old["approval"], reservation)
        for field in ("source_id", "radius_company_id", "radius_franchise_id"):
            require(reservation[field] == receipt[field], "replacement_binding_conflict")
        for field in ("service_request_id", "username", "plan_id"):
            require(reservation[field] == old["service"][field], "replacement_binding_conflict")
    require(old_reservation["plan_version"] == new_reservation["plan_version"], "replacement_binding_conflict")
    require(old_reservation["reservation_id"] == old["service"]["reservation_id"], "replacement_binding_conflict")
    require(new_reservation["reservation_id"] == new["service"]["reservation_id"], "replacement_binding_conflict")
    require(new_reservation["reservation_id"] != old_reservation["reservation_id"], "replacement_binding_conflict")


def receipt_transition(before, after):
    for receipt in (before, after):
        validator("provisioningReceiptV1").validate(receipt)
    bindings(before, after)
    for field in ("source_id", "event_id", "service_request_id", "radius_company_id", "radius_franchise_id"):
        require(before[field] == after[field], "receipt_binding_conflict")
    require(after["receipt_version"] > before["receipt_version"], "stale_receipt")
    require(not before["credential_accepted"] or after["credential_accepted"], "credential_acceptance_regressed")
    if before["service_id"] is not None:
        require(before["service_id"] == after["service_id"], "service_identity_changed")


class RoundTwoContractTests(unittest.TestCase):
    def test_schema_and_all_positive_fixtures(self):
        Draft202012Validator.check_schema(SCHEMA)
        cases = {"customer-master": "customerMaster", "unapproved-customer": "customerMaster", "applications": "applicationPage",
                 "approval-a": "exactApproval", "approval-b": "exactApproval", "withdrawn-a": "exactApproval", "plans": "planPage",
                 "reservation": "reservation", "replacement-reservation": "reservation", "provisioning-v2": "provisioningRequestV2",
                 "replacement-v2": "provisioningRequestV2", "unaccepted-expired-v2": "provisioningReceiptV2",
                 "accepted-setup-failed": "provisioningReceiptV1", "bootstrap-start": "bootstrapStart",
                 "bootstrap-page": "bootstrapPage", "bootstrap-empty": "bootstrapPage"}
        for name, definition in cases.items():
            with self.subTest(fixture=name):
                semantics(definition, fixture(name))
        validator("error", READ).validate(fixture("cursor-expired"))

    def test_runtime_nested_checks_required_beyond_schema(self):
        for case in load(FIXTURES / "negative-cases.json"):
            data = load(FIXTURES / case["fixture"])
            parent = data
            for field in case["path"][:-1]:
                parent = parent[field]
            parent[case["path"][-1]] = case["value"]
            with self.subTest(case=case["name"]):
                # Structural validation intentionally cannot detect these cross-field errors.
                validator(case["definition"]).validate(data)
                with self.assertRaisesRegex(ValueError, "^" + case["error"] + "$"):
                    semantics(case["definition"], data)

    def test_draft_identity_has_no_fake_application_reference(self):
        data = fixture("unapproved-customer")
        self.assertEqual(data["customer_version"], 0)
        self.assertIsNone(data["approved_profile"])
        self.assertIsNone(data["identity_review"]["revision_id"])
        data["identity_review"]["application_id"] = data["identity_review"]["draft_id"]
        self.assertFalse(validator("customerMaster").is_valid(data))

    def test_pending_profile_values_and_credentials_are_excluded(self):
        for field in ("pending_profile", "documents", "password", "idNumber", "dob"):
            data = fixture("customer-master")
            data[field] = "DO-NOT-SEND"
            self.assertFalse(validator("customerMaster").is_valid(data))

    def test_both_delivery_orders_keep_a_and_b_without_profile_rollback(self):
        a, b = fixture("approval-a"), fixture("approval-b")
        for records in ((a, b), (b, a)):
            applied_profile_version, profile, eligible = 0, None, set()
            for record in records:
                semantics("exactApproval", record)
                # Protocol expectation only: never globally discard a connection
                # because its profile version is lower than a previously seen one.
                applied_profile_version, profile = profile_advance(applied_profile_version, profile, record["approval_event"])
                if record["approval_status"] == "APPROVED":
                    eligible.add(record["service_request_id"])
            self.assertEqual(applied_profile_version, 3)
            self.assertEqual(eligible, {a["service_request_id"], b["service_request_id"]})

    def test_equal_profile_version_allows_other_connection_but_not_changed_identity(self):
        a, b = fixture("approval-a"), fixture("approval-b")
        another = deepcopy(b["approval_event"])
        another["customer_version"] = a["approval_event"]["customer_version"]
        another["profile"] = deepcopy(a["approval_event"]["profile"])
        version, profile = profile_advance(0, None, a["approval_event"])
        self.assertEqual(profile_advance(version, profile, another), (version, profile))
        another["profile"]["name"] = "Conflicting identity at same version"
        with self.assertRaisesRegex(ValueError, "^profile_version_conflict$"):
            profile_advance(version, profile, another)

    def test_delayed_a_does_not_restore_withdrawn_service_approval(self):
        delayed, authoritative = fixture("approval-a"), fixture("withdrawn-a")
        semantics("exactApproval", authoritative)
        self.assertEqual(delayed["approval_id"], authoritative["approval_id"])
        self.assertGreater(authoritative["approval_version"], delayed["approval_version"])
        self.assertNotEqual(authoritative["approval_status"], "APPROVED")

    def test_fixed_validity_minor_unit_prices_and_no_calendar_coercion(self):
        original = fixture("plans")
        for path, value in ((["validity", "duration_seconds"], 0), (["validity", "starts_at"], "purchase"), (["price", "amount_minor"], 999.5), (["price", "minor_unit_exponent"], -1), (["download_kbps"], 0)):
            data = deepcopy(original)
            parent = data["items"][0]
            for field in path[:-1]:
                parent = parent[field]
            parent[path[-1]] = value
            self.assertFalse(validator("planPage").is_valid(data))
        data = deepcopy(original)
        data["items"][0]["validity"] = {"calendar_months": 1, "starts_at": "activation"}
        self.assertFalse(validator("planPage").is_valid(data))

    def test_full_reservation_binding_and_plan_version_required(self):
        original = fixture("reservation")
        for field in original:
            data = deepcopy(original)
            del data[field]
            with self.subTest(field=field):
                self.assertFalse(validator("reservation").is_valid(data))

    def test_expired_reservation_replacement_keeps_approval_and_immutable_request(self):
        replacement_allowed(fixture("provisioning-v2"), fixture("replacement-v2"), fixture("unaccepted-expired-v2"), fixture("reservation"), fixture("replacement-reservation"))

    def test_replacement_rejects_accepted_unknown_or_changed_predecessor(self):
        old, new, receipt = fixture("provisioning-v2"), fixture("replacement-v2"), fixture("unaccepted-expired-v2")
        variants = [(None, "receipt_reconciliation_required")]
        accepted = deepcopy(receipt)
        accepted["credential_accepted"] = True
        variants.append((accepted, "replacement_not_allowed"))
        unknown = deepcopy(receipt)
        unknown["receipt_status"] = "processing"
        variants.append((unknown, "receipt_reconciliation_required"))
        for predecessor, code in variants:
            with self.assertRaisesRegex(ValueError, "^" + code + "$"):
                replacement_allowed(old, new, predecessor, fixture("reservation"), fixture("replacement-reservation"))
        for field in ("username", "plan_id", "initial_password", "service_request_id"):
            changed = deepcopy(new)
            changed["service"][field] = "DifferentSyntheticPassword!" if field == "initial_password" else ("different.username" if field == "username" else "87f496c8-4ff8-4fae-bf57-74b76931afef")
            with self.assertRaisesRegex(ValueError, "^replacement_binding_conflict$"):
                replacement_allowed(old, changed, receipt, fixture("reservation"), fixture("replacement-reservation"))
        changed = deepcopy(new)
        changed["provisioning_request_id"] = old["provisioning_request_id"]
        with self.assertRaisesRegex(ValueError, "^replay_conflict$"):
            replacement_allowed(old, changed, receipt, fixture("reservation"), fixture("replacement-reservation"))

    def test_acceptance_is_monotonic_through_setup_failure(self):
        after = fixture("accepted-setup-failed")
        before = deepcopy(after)
        before.update(receipt_version=1, receipt_status="accepted", service_status="pending_service_setup", error=None)
        receipt_transition(before, after)
        self.assertTrue(after["credential_accepted"])
        self.assertEqual(after["service_status"], "failed")
        regressed = deepcopy(after)
        regressed.update(receipt_version=3, credential_accepted=False)
        with self.assertRaisesRegex(ValueError, "^credential_acceptance_regressed$"):
            receipt_transition(after, regressed)

    def test_replacement_rejects_changed_plan_version_scope_or_approval(self):
        old, new, receipt = fixture("provisioning-v2"), fixture("replacement-v2"), fixture("unaccepted-expired-v2")
        for field, value in (("plan_version", 8), ("source_id", "another-source"), ("radius_company_id", "10002"), ("radius_franchise_id", "20002")):
            changed = fixture("replacement-reservation")
            changed[field] = value
            with self.assertRaisesRegex(ValueError, "^replacement_binding_conflict$"):
                replacement_allowed(old, new, receipt, fixture("reservation"), changed)
        changed = deepcopy(new)
        changed["approval"]["event_id"] = "87f496c8-4ff8-4fae-bf57-74b76931afef"
        with self.assertRaisesRegex(ValueError, "^replacement_binding_conflict$"):
            replacement_allowed(old, changed, receipt, fixture("reservation"), fixture("replacement-reservation"))

    def test_receipt_operation_identity_and_active_require_acceptance(self):
        v2 = fixture("unaccepted-expired-v2")
        self.assertNotEqual(v2["event_id"], v2["provisioning_request_id"])
        invalid = fixture("accepted-setup-failed")
        invalid.update(credential_accepted=False, service_status="active")
        self.assertFalse(validator("provisioningReceiptV1").is_valid(invalid))

    def test_bootstrap_empty_page_preserves_snapshot_boundary(self):
        start, populated, empty = fixture("bootstrap-start"), fixture("bootstrap-page"), fixture("bootstrap-empty")
        for page in (populated, empty):
            for field in ("snapshot_id", "expires_at", "continuation_cursor"):
                self.assertEqual(start[field], page[field])
        self.assertEqual(empty["items"], [])
        self.assertIsNone(empty["next_cursor"])
        self.assertFalse(empty["has_more"])
        self.assertTrue(empty["continuation_cursor"])

    def test_bootstrap_never_checkpoints_partial_or_mixed_snapshot(self):
        start, first, last = fixture("bootstrap-start"), fixture("bootstrap-page"), fixture("bootstrap-empty")
        first.update(has_more=True, next_cursor="opaque-second-page-example")
        self.assertIsNone(bootstrap_checkpoint(start, [first]))
        self.assertEqual(bootstrap_checkpoint(start, [first, last]), start["continuation_cursor"])
        for field, value in (("snapshot_id", "87f496c8-4ff8-4fae-bf57-74b76931afef"), ("continuation_cursor", "different-boundary")):
            mixed = deepcopy(last)
            mixed[field] = value
            with self.assertRaisesRegex(ValueError, "^mixed_bootstrap_boundary$"):
                bootstrap_checkpoint(start, [first, mixed])


if __name__ == "__main__":
    unittest.main(verbosity=2)
