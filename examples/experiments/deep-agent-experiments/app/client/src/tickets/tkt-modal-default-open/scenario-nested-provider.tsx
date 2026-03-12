/**
 * Scenario 4 — Nested provider: child's isModalDefaultOpen is overridden
 *
 * The current resolution logic on main:
 *
 *   const resolvedIsModalOpen = parentConfig?.isModalOpen ?? internalModalOpen;
 *
 * When a parent provider exists and has a defined isModalOpen (which is always
 * the case since #3313 made it non-optional), the child inherits the parent's
 * value instead of using its own isModalDefaultOpen.
 *
 * This means nesting two bare providers with different defaults doesn't work:
 *
 *   <Provider isModalDefaultOpen={true}>      ← isModalOpen = true
 *     <Provider isModalDefaultOpen={false}>   ← isModalOpen = true (parent wins)
 *       <ModalProbe expected={false} />       ← FAIL
 */

import { CopilotChatConfigurationProvider } from "@copilotkit/react-core/v2";
import { TAG, ModalProbe } from "./lib";

export function NestedProviderScenario() {
  console.log(`\n${TAG} ===== Scenario: Nested provider leak =====`);
  console.log(`${TAG} Does a child provider respect its own isModalDefaultOpen,`);
  console.log(`${TAG} or does it inherit the parent's isModalOpen value?\n`);

  return (
    <div className="p-4 space-y-6">
      {/* Controls — standalone providers, no nesting */}
      <div className="space-y-3">
        <div className="text-xs text-gray-500 font-semibold uppercase tracking-wide">
          Controls (standalone — no nesting)
        </div>
        <div className="space-y-2">
          <CopilotChatConfigurationProvider isModalDefaultOpen={false}>
            <ModalProbe
              label="Standalone provider (isModalDefaultOpen=false)"
              expected={false}
            />
          </CopilotChatConfigurationProvider>
          <CopilotChatConfigurationProvider isModalDefaultOpen={true}>
            <ModalProbe
              label="Standalone provider (isModalDefaultOpen=true)"
              expected={true}
            />
          </CopilotChatConfigurationProvider>
        </div>
      </div>

      {/* Nested: outer=true, inner=false */}
      <div className="border-t pt-4 space-y-3">
        <div className="text-xs text-gray-500 font-semibold uppercase tracking-wide">
          Nested: outer=true, inner=false
        </div>
        <div className="text-xs text-gray-500">
          Inner provider sets <code>isModalDefaultOpen=false</code>. But parent
          has <code>isModalOpen=true</code> which leaks into child via{" "}
          <code>parentConfig?.isModalOpen ?? internalModalOpen</code>.
        </div>
        <CopilotChatConfigurationProvider isModalDefaultOpen={true}>
          <div className="space-y-2">
            <ModalProbe
              label="Outer provider (isModalDefaultOpen=true)"
              expected={true}
            />
            <CopilotChatConfigurationProvider isModalDefaultOpen={false}>
              <ModalProbe
                label="Inner provider (isModalDefaultOpen=false)"
                expected={false}
              />
            </CopilotChatConfigurationProvider>
          </div>
        </CopilotChatConfigurationProvider>
      </div>

      {/* Nested: outer=false, inner=true */}
      <div className="border-t pt-4 space-y-3">
        <div className="text-xs text-gray-500 font-semibold uppercase tracking-wide">
          Nested: outer=false, inner=true
        </div>
        <div className="text-xs text-gray-500">
          Same issue in reverse — inner wants <code>true</code> but parent's{" "}
          <code>false</code> overrides it.
        </div>
        <CopilotChatConfigurationProvider isModalDefaultOpen={false}>
          <div className="space-y-2">
            <ModalProbe
              label="Outer provider (isModalDefaultOpen=false)"
              expected={false}
            />
            <CopilotChatConfigurationProvider isModalDefaultOpen={true}>
              <ModalProbe
                label="Inner provider (isModalDefaultOpen=true)"
                expected={true}
              />
            </CopilotChatConfigurationProvider>
          </div>
        </CopilotChatConfigurationProvider>
      </div>
    </div>
  );
}
