/**
 * JSON body limit. Express defaults to 100kb, but completing a 10GB upload
 * sends up to 10,000 `{ part_number, etag }` entries (~600kb).
 */
export const JSON_BODY_LIMIT = '2mb';
