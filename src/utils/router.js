/**
 * Simple Hash-Based SPA Router
 */

const routes = {};
let currentView = null;

export function registerRoute(path, handler) {
  routes[path] = handler;
}

export function navigate(path) {
  if (window.location.hash !== `#${path}`) {
    window.location.hash = path;
  } else {
    handleRoute();
  }
}

function handleRoute() {
  const hash = window.location.hash.slice(1) || '/login';
  const handler = routes[hash] || routes['/login'];

  if (handler) {
    currentView = hash;
    handler();
  }
}

export function initRouter() {
  window.addEventListener('hashchange', handleRoute);
  handleRoute();
}

export function getCurrentRoute() {
  return currentView || window.location.hash.slice(1) || '/login';
}
