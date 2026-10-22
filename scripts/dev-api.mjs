// The browser and API must agree on the origin for real CSRF validation.
process.env.APP_ORIGIN = process.env.WEB_ORIGIN ?? 'http://127.0.0.1:5173';
await import('../apps/api/src/server.ts');
