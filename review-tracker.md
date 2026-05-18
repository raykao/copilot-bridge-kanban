# Review Tracker - Legacy Removal

Branch: `feat/legacy-removal`
Baseline: 212 tests

| Task | Commit | Scores (C/Comp/Cl/T/Ty) | Verdict | Notes |
|------|--------|--------------------------|---------|-------|
| T1   | 6d0fc6e | 5/5/5/5/5               | PASS    | migration 007, Run/NewRun updated, createRun/updateRun updated |
| T2   | 7b1fe6c | 5/5/5/5/5               | PASS    | BridgeConfig interface, reconnect() method, AppConfig removed |
| T8   | 3b16410 | 5/5/5/5/5               | PASS    | UI-only; 6 migration test failures from concurrent T1 (unrelated) |
| T3   | e4db255 | 5/5/5/5/5               | PASS    | constructor injection, AppConfig shim removed, imports collapsed |
| T4   | d905430 | 5/5/5/5/5               | PASS    | bridge env vars removed, 2 config tests removed (210 total) |
| T5   | bbe1ac9 | 5/5/5/5/5               | PASS    | providerManagers map, __env_bridge__ removed, reconnect loop |
| T6   | d5574db | 5/5/5/5/5               | PASS    | providerManagers CRUD in admin routes, test updated |
| T7   | 0acc269 | 5/5/3/5/5               | FIX->PASS | dead `void providerManagers` removed in e1a5317 |
