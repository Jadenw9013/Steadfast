import type { Instrumentation } from "next";
import { SERVER_UNHANDLED } from "@/lib/observability/events";
import { reportServerError } from "@/lib/observability/report";

export const onRequestError: Instrumentation.onRequestError = async (
  error,
  request,
  context
) => {
  try {
    // `request.headers` is deliberately never read or forwarded.
    reportServerError(SERVER_UNHANDLED.evt, error, {
      route: request.path,
      method: request.method,
      context: {
        routerKind: context.routerKind,
        routePath: context.routePath,
        routeType: context.routeType,
        renderSource: context.renderSource ?? "",
        revalidateReason: context.revalidateReason ?? "",
      },
      allow: SERVER_UNHANDLED.allow,
    });
  } catch {
    // An instrumentation failure must never re-enter Next's error path.
  }
};
