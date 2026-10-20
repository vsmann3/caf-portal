# Indian address dropdown data

`india-cities.json` is the India state/city subset of
https://github.com/dr5hn/countries-states-cities-database at revision
`6f41c42e0e767d694232df37e3753f5ce63b8745`, retrieved 2026-10-21.
Only state and city names are retained, grouped and sorted by state.
The source license is included in `ADDRESS-DATA-LICENSE`. This is community
address reference data, not proof of residence or an official exhaustive city list.
Preserve attribution and the source license when redistributing the subset.

PIN lookup uses https://api.postalpincode.in/pincode/{PIN} server-side with a
timeout. Only the PIN is sent. Results expose post-office locality and district
separately; district is not assumed to be city. Multiple localities require a
selection. Manual city correction remains available for incomplete reference data
and provider outages. No identity/contact details are sent to the lookup service.

To refresh, retrieve the source at a reviewed commit, select country iso2 `IN`,
group unique city names by state name, compare state/city changes, retain the
license and record the new commit here. No live API is needed for dropdowns.

The derived `india-cities.json` database is distributed under the same ODbL
license. Copyright/attribution: CSC Database contributors (dr5hn).
