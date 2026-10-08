// Swagger UI bootstrap. Kept as a static file so the page needs no inline script (CSP script-src 'self').
// StandaloneLayout adds the top bar with the dark-mode toggle (light bulb); the preset starts in
// dark mode when the operating system prefers a dark colour scheme.
window.addEventListener('load', function () {
  window.ui = SwaggerUIBundle({
    url: '/openapi.json',
    dom_id: '#swagger-ui',
    deepLinking: true,
    persistAuthorization: false,
    displayRequestDuration: true,
    presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
    plugins: [SwaggerUIBundle.plugins.DownloadUrl],
    layout: 'StandaloneLayout',
  });
});
