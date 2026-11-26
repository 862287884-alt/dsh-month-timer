/**
 * Host half of dsh-month-timer.
 *
 * The feature itself lives in the browser half (client.js): a floating card the
 * client renders through the `shell.overlay` slot. This half stays small on
 * purpose — it only exposes one diagnostic route.
 *
 * Why: the Desktop renderer's console cannot be reached from outside the app,
 * so a client-side boot failure is invisible (the plugin looks enabled while
 * nothing renders). The client posts short progress markers here, and they are
 * appended to a plain text file that is easy to read afterwards:
 *
 *   %TEMP%\dsh-month-timer-boot.log
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";

const BEACON_PATH = join(tmpdir(), "dsh-month-timer-boot.log");
const BEACON_PREFIX = "/_dsh/dsh-month-timer/beacon";
const GRAPH_PREFIX = "/_dsh/dsh-month-timer/graph";

function record(line) {
  try {
    mkdirSync(dirname(BEACON_PATH), { recursive: true });
    appendFileSync(BEACON_PATH, `${line}\n`, "utf8");
  } catch {
    /* diagnostics must never break the host */
  }
}

export function apply(ctx) {
  try {
    record(`--- host half loaded ${new Date().toISOString()}`);
    ctx.inject(["webServer"], (webCtx) => {
      webCtx.effect(
        () =>
          webCtx.webServer.register({
            kind: "prefix",
            path: BEACON_PREFIX,
            resource: async (request) => {
              let body = "";
              try {
                body = await request.text();
              } catch {
                body = "";
              }
              record(`${new Date().toISOString()} ${body.slice(0, 2000)}`);
              return new Response("ok", { headers: { "content-type": "text/plain" } });
            },
          }),
        "month-timer: boot beacon route",
      );
    });

    // Diagnostic: report whether this package is in the composed client graph.
    // Without it a missing client half is indistinguishable from a throwing one.
    ctx.inject(["webServer", "clientModules"], (webCtx) => {
      webCtx.effect(
        () =>
          webCtx.webServer.register({
            kind: "prefix",
            path: GRAPH_PREFIX,
            resource: async () => {
              const report = { package: "dsh-month-timer", clientModules: true };
              try {
                const service = webCtx.clientModules;
                const graph = typeof service.graph === "function" ? service.graph() : null;
                const entries = graph && Array.isArray(graph.entries) ? graph.entries : [];
                report.entryCount = entries.length;
                report.ids = entries.map((entry) => entry.id);
                report.ours = entries.find((entry) => entry.id === "dsh-month-timer") ?? null;
                try {
                  report.clientPath = service.clientPath("dsh-month-timer") ?? null;
                } catch (error) {
                  report.clientPathError = String(error && error.message);
                }
              } catch (error) {
                report.error = String(error && error.message);
              }
              return new Response(JSON.stringify(report, null, 1), {
                headers: { "content-type": "application/json" },
              });
            },
          }),
        "month-timer: client graph probe",
      );
    });
  } catch (error) {
    // A diagnostic route must never be the reason the host row fails to mount.
    record(`--- host half failed: ${error && error.message ? error.message : String(error)}`);
  }
}
