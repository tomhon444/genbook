"use client";

// @coreui/icons-react uses hooks without a "use client" directive, so Server
// Components must render CoreUI icons through this client boundary.
export { default as Icon } from "@coreui/icons-react";
