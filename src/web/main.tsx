import { createRoot } from "react-dom/client";
import { App } from "./app/App";

const root = document.getElementById("root");
if (!root) throw new Error("missing #root mount point");

createRoot(root).render(<App />);
