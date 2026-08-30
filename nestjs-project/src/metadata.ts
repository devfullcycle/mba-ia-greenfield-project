// Stub for @nestjs/swagger CLI plugin metadata.
// When using the TypeScript AST transformer (tsc path), the plugin injects
// __OPENAPI_METADATA_FACTORY__ methods directly into compiled DTO classes —
// no separate file is generated. This stub satisfies the import in main.ts.
// Replace with the output of PluginMetadataGenerator when migrating to SWC.
export default (): Promise<Record<string, unknown>> => Promise.resolve({});
