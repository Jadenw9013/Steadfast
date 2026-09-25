# Legacy Prisma baseline

This directory formalizes the repository's existing baseline/forward-migration history without changing any applied migration.

The migrations before and including `20260915000000_message_coach_backfill_single_coach` were created while the deployed database already contained schema introduced outside the migration ledger. That is why running the unchanged chain against an empty database previously failed first at `20260216000000_add_checkin_status`: the expected `CheckIn_clientId_weekOf_idx` did not exist yet. Fixing only that statement exposes later missing marketplace and exercise-history state.

`baseline.sql` is the Prisma schema snapshot from commit `2d41eba7eb21e5c51f457f451ef2a113d4c6ada9`, immediately after the baseline cutoff. It also preserves the three earlier raw-SQL invariants that Prisma schema syntax cannot represent:

- `MealPlan_one_published_per_client_week`;
- `TrainingProgram_one_published_per_client`; and
- `AiWorkoutSession_modality_check`.

The snapshot checksum, the original February migration checksum and a complete checksum manifest for all 66 resolved migrations are enforced by `scripts/replay-prisma-migrations.sh` and regression-tested. Do not edit or relocate historical migrations to make replay pass.

## Safe usage

This workflow is for a newly created, empty, local disposable PostgreSQL database only. The script rejects remote hosts, non-empty databases, non-public schemas, and database names without the `steadfast_migration_replay_` prefix.

```bash
createdb --host=127.0.0.1 --username="$USER" steadfast_migration_replay_validation
DATABASE_URL="postgresql://$USER@127.0.0.1:5432/steadfast_migration_replay_validation" \
  pnpm run prisma:replay
dropdb --host=127.0.0.1 --username="$USER" steadfast_migration_replay_validation
```

The script installs the snapshot, records all 66 preserved legacy migrations as applied through the official Prisma resolver, and executes every later migration normally. It then requires an up-to-date migration ledger, zero Prisma schema diff, and the raw-SQL invariants above.

This baseline is outside `prisma/migrations/`, so normal `prisma migrate deploy` behavior and every existing production checksum remain unchanged. Existing deployed databases must not run this bootstrap script and require no baseline action.
