-- Read-only preflight for the CAF redesign migration. No account is renamed.
SELECT "companyId", LOWER(BTRIM("broadbandUsername")) AS username, COUNT(*) AS records
FROM "CustomerApplication"
WHERE NULLIF(BTRIM("broadbandUsername"), '') IS NOT NULL
GROUP BY "companyId", LOWER(BTRIM("broadbandUsername")) HAVING COUNT(*) > 1;
