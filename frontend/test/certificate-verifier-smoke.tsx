import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRootRoute, createRouter, Outlet, RouterProvider } from "@tanstack/react-router";
import { Route as certificateRoute } from "../src/routes/sertifikat";

// Mount the actual public route without the unrelated wallet/deployment shell.
const client = new QueryClient();
const root = createRootRoute({
  component: () => <QueryClientProvider client={client}><Outlet /></QueryClientProvider>,
});
const route = certificateRoute.update({
  id: "/sertifikat", path: "/sertifikat", getParentRoute: () => root,
} as any);
const router = createRouter({ routeTree: root.addChildren([route]) });
createRoot(document.getElementById("root")!).render(<RouterProvider router={router} />);
