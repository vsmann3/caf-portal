# Change log

## 2026-10-20

- Scope the Git and Docker storage exclusions to `/storage/` so storage source files remain included.
- Exclude `*.bak` backup files from Git and the Docker build context.
- Create `public` in the Docker builder stage so the runner can copy it even when the source directory is absent.
- Add the four storage implementation modules: `index.ts`, `local.ts`, `s3.ts`, and `types.ts` under `src/lib/storage/`.

Validation: Git whitespace checks passed. A clean Docker build could not run because the Docker command is unavailable in this environment.
