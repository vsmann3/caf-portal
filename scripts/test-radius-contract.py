"""Offline contract fixtures only; no application/DB/live API validation claimed.

Test dependency: jsonschema==4.25.1. Run: python scripts/test-radius-contract.py
"""
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import unittest

from jsonschema import Draft202012Validator, FormatChecker
from referencing import Registry, Resource

ROOT = Path(__file__).resolve().parents[1] / "docs/integrations/radius"
REFERENCE = ROOT / "reference"


def load(path):
    def unique_keys(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError(f"Duplicate JSON key: {key}")
            result[key] = value
        return result
    return json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=unique_keys)


EVENT = load(REFERENCE / "ecaf-event.schema.json")
PROVISIONING = load(REFERENCE / "ecaf-provisioning.schema.json")
READ = load(ROOT / "caf-read-api.proposed.schema.json")
REGISTRY = Registry().with_resources(
    (schema["$id"], Resource.from_contents(schema))
    for schema in (EVENT, PROVISIONING, READ)
)


def validator(schema, definition=None):
    selected = {"$ref": schema["$id"] + "#/$defs/" + definition} if definition else schema
    return Draft202012Validator(selected, registry=REGISTRY, format_checker=FormatChecker())


class RadiusContractTests(unittest.TestCase):
    def test_schemas_and_reference_hashes(self):
        for schema in (EVENT, PROVISIONING, READ):
            with self.subTest(schema=schema["$id"]):
                Draft202012Validator.check_schema(schema)
        source = load(REFERENCE / "SOURCE.json")
        self.assertEqual(source["commit"], "1db3699e70de37e9d55efb3ff5f750b0f20348a3")
        for item in source["files"]:
            self.assertEqual(hashlib.sha256((REFERENCE / item["file"]).read_bytes()).hexdigest(), item["sha256"])

    def test_canonical_examples(self):
        validator(EVENT).validate(load(REFERENCE / "ecaf-event.example.json"))
        validator(PROVISIONING).validate(load(REFERENCE / "ecaf-provisioning.example.json"))

    def test_lifetime_id_multiple_connections(self):
        first = load(REFERENCE / "ecaf-provisioning.example.json")
        second = load(ROOT / "examples/additional-service.example.json")
        validator(PROVISIONING).validate(second)
        self.assertEqual(first["approval"]["customer_id"], second["approval"]["customer_id"])
        for field in ("service_request_id", "reservation_id", "username"):
            self.assertNotEqual(first["service"][field], second["service"][field])
        self.assertNotEqual(first["approval"]["event_id"], second["approval"]["event_id"])
        self.assertNotEqual(first["approval"]["caf"]["application_id"], second["approval"]["caf"]["application_id"])
        self.assertGreater(second["approval"]["customer_version"], first["approval"]["customer_version"])
        self.assertEqual(first["approval"]["company_ref"], second["approval"]["company_ref"])

    def test_invalid_customer_ids_versions_and_approval(self):
        original = load(REFERENCE / "ecaf-event.example.json")
        changes = [("customer_id", v) for v in ("123", "0123456789", "10000000000", 1000000123, "100000012a")]
        changes += [("customer_version", v) for v in (0, -1, 1.5, 9007199254740992)]
        changes += [("occurred_at", "2026-10-22T03:00:00+00:00"), ("event_id", "not-a-uuid"), ("event_type", "customer.rejected")]
        for field, value in changes:
            with self.subTest(field=field, value=value):
                data = deepcopy(original)
                data[field] = value
                self.assertFalse(validator(EVENT).is_valid(data))
        for state in ("DRAFT", "SUBMITTED", "UNDER_REVIEW", "REJECTED"):
            data = deepcopy(original)
            data["caf"]["status"] = state
            self.assertFalse(validator(EVENT).is_valid(data))

    def test_approval_excludes_sensitive_and_unagreed_fields(self):
        original = load(REFERENCE / "ecaf-event.example.json")
        for field in ("idNumber", "idProofType", "dob", "documents", "password", "initial_password", "nas_secret", "installationAddress"):
            for where in ("root", "profile"):
                with self.subTest(field=field, where=where):
                    data = deepcopy(original)
                    (data if where == "root" else data["profile"])[field] = "DO-NOT-SEND"
                    self.assertFalse(validator(EVENT).is_valid(data))

    def test_provisioning_requirements(self):
        original = load(REFERENCE / "ecaf-provisioning.example.json")
        for field in original["service"]:
            data = deepcopy(original)
            del data["service"][field]
            with self.subTest(missing=field):
                self.assertFalse(validator(PROVISIONING).is_valid(data))
        for field, value in (("plan_id", "Business 300"), ("username", "name with spaces"), ("initial_password", ""), ("initial_password", "x" * 129)):
            data = deepcopy(original)
            data["service"][field] = value
            self.assertFalse(validator(PROVISIONING).is_valid(data))
        # Shared schema bounds characters; the future servers must ALSO enforce
        # PAP's UTF-8-byte limit. Do not claim this schema alone enforces that rule.
        data = deepcopy(original)
        data["service"]["initial_password"] = "\u0930" * 43
        self.assertTrue(validator(PROVISIONING).is_valid(data))
        self.assertGreater(len(data["service"]["initial_password"].encode("utf-8")), 128)

    def test_proposed_read_examples(self):
        for file, definition in (("companies", "companyPage"), ("franchises", "franchisePage"), ("customer-pending-review", "customerSnapshot"), ("error", "error")):
            with self.subTest(file=file):
                validator(READ, definition).validate(load(ROOT / "examples" / (file + ".example.json")))
        data = load(ROOT / "examples/customer-pending-review.example.json")
        approved = data["approved_snapshot"]
        self.assertEqual(data["customer_id"], approved["customer_id"])
        self.assertEqual(data["company_ref"], approved["company_ref"])
        self.assertEqual(data["franchise_ref"], approved["franchise_ref"])
        self.assertLessEqual(approved["customer_version"], data["customer_version"])
        self.assertEqual(data["review"]["status"], "UNDER_REVIEW")
        self.assertGreater(data["review"]["revision"], approved["caf"]["revision"])

    def test_unapproved_has_no_profile(self):
        data = load(ROOT / "examples/customer-pending-review.example.json")
        data["approved_snapshot"] = None
        data["customer_version"] = 0
        validator(READ, "customerSnapshot").validate(data)
        for field in ("profile", "pending_profile", "documents", "apiKey", "password"):
            changed = deepcopy(data)
            changed[field] = "DO-NOT-SEND"
            with self.subTest(field=field):
                self.assertFalse(validator(READ, "customerSnapshot").is_valid(changed))

    def test_directory_bounds_and_no_secrets(self):
        for file, definition in (("companies", "companyPage"), ("franchises", "franchisePage")):
            original = load(ROOT / "examples" / (file + ".example.json"))
            for field in ("apiKey", "staff", "passwordHash", "documents"):
                data = deepcopy(original)
                data["items"][0][field] = "DO-NOT-SEND"
                self.assertFalse(validator(READ, definition).is_valid(data))
            data = deepcopy(original)
            data["items"] = [data["items"][0]] * 101
            self.assertFalse(validator(READ, definition).is_valid(data))
            data = deepcopy(original)
            data["has_more"] = True
            data["next_cursor"] = None
            self.assertFalse(validator(READ, definition).is_valid(data))
        data = load(ROOT / "examples/franchises.example.json")
        del data["items"][0]["company_id"]
        self.assertFalse(validator(READ, "franchisePage").is_valid(data))


if __name__ == "__main__":
    unittest.main(verbosity=2)
