// The pre-construction workspace. Split out of a single 3,175-line
// PcWorkspace.tsx in audit batch 4 (code #10, ux #19); this barrel keeps the
// old module path — `features/preconstruction/PcWorkspace` — working for
// App.tsx, BidHubPage, UnitCostSection and the nine existing test files.
export { default } from './PcWorkspaceView';
export { resetGlobalPcCaches, __resetGlobalPcCachesForTests } from './globalCache';
export { scopeSectionsFrom } from './parsing';
