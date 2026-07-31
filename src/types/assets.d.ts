// Asset module declarations for Bun's on-the-fly transform / HTML imports.
// @types/bun covers most of these; this declaration is a defensive fallback
// so `tsc` (which does not run Bun's transformer) accepts the imports.
declare module "*.html" {
  const content: unknown;
  export default content;
}
declare module "*.css" {
  const content: unknown;
  export default content;
}
