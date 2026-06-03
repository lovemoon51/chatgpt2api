export const stripInjectedTextShadowScript = String.raw`
(() => {
  const stripTextShadow = (root) => {
    if (!root || root.nodeType !== 1) {
      return;
    }

    const strip = (element) => {
      if (element?.style?.textShadow) {
        element.style.removeProperty("text-shadow");
        if (!element.getAttribute("style")) {
          element.removeAttribute("style");
        }
      }
    };

    strip(root);
    root.querySelectorAll?.("[style]").forEach(strip);
  };

  stripTextShadow(document.documentElement);

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === "attributes") {
        stripTextShadow(mutation.target);
      } else {
        mutation.addedNodes.forEach(stripTextShadow);
      }
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["style"],
  });

  window.addEventListener("load", () => {
    window.setTimeout(() => observer.disconnect(), 3000);
  }, { once: true });
})();
`;
