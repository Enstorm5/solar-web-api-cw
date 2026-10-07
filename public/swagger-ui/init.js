// Swagger UI bootstrap. Kept as a static file so the page needs no inline script (CSP script-src 'self').
window.addEventListener('load', function () {
  window.ui = SwaggerUIBundle({
    url: '/openapi.json',
    dom_id: '#swagger-ui',
    deepLinking: true,
    persistAuthorization: false,
    displayRequestDuration: true,
  });
});
