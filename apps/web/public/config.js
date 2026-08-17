// Runtime config. Baked default is for local dev where Vite proxies /api → api server.
// In deployed environments a k8s ConfigMap mounts a different config.js at
// /usr/share/nginx/html/config.js, overriding this file without a rebuild.
window.__LENS_CONFIG__ = {
  API_BASE_URL: '/api',
};
