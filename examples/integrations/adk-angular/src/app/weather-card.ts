import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from "@angular/core";
import { z } from "zod";
import type { AngularToolCall, ToolRenderer } from "@copilotkit/angular";

export const weatherArgs = z.object({ location: z.string().optional() });
type WeatherArgs = z.infer<typeof weatherArgs>;

@Component({
  selector: "app-weather-card",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="wc">
      <div class="wc-inner">
        <div class="wc-head">
          <div>
            <h3>{{ location() }}</h3>
            <p>Current Weather</p>
          </div>
          <span class="sun">☀️</span>
        </div>
        <div class="wc-temp">
          <span class="deg">70°</span><span>Clear skies</span>
        </div>
        <div class="wc-grid">
          <div>
            <p class="k">Humidity</p>
            <p class="v">45%</p>
          </div>
          <div>
            <p class="k">Wind</p>
            <p class="v">5 mph</p>
          </div>
          <div>
            <p class="k">Feels Like</p>
            <p class="v">72°</p>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      .wc {
        border-radius: 0.75rem;
        box-shadow: 0 20px 40px rgba(0, 0, 0, 0.2);
        margin: 1.5rem 0 1rem;
        max-width: 28rem;
        width: 100%;
        background: var(--copilot-kit-primary-color, #6366f1);
      }
      .wc-inner {
        background: rgba(255, 255, 255, 0.2);
        padding: 1rem;
        color: #fff;
        border-radius: 0.75rem;
      }
      .wc-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
      .wc-head h3 {
        margin: 0;
        font-size: 1.25rem;
        font-weight: 700;
        text-transform: capitalize;
      }
      .wc-head p {
        margin: 0;
      }
      .sun {
        font-size: 2.5rem;
      }
      .wc-temp {
        margin-top: 1rem;
        display: flex;
        align-items: flex-end;
        justify-content: space-between;
      }
      .deg {
        font-size: 1.875rem;
        font-weight: 700;
      }
      .wc-grid {
        margin-top: 1rem;
        padding-top: 1rem;
        border-top: 1px solid #fff;
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 0.5rem;
        text-align: center;
      }
      .k {
        font-size: 0.75rem;
        margin: 0;
      }
      .v {
        font-weight: 500;
        margin: 0;
      }
    `,
  ],
})
export class WeatherCard implements ToolRenderer<WeatherArgs> {
  readonly toolCall = input.required<AngularToolCall<WeatherArgs>>();
  protected readonly location = computed(
    () => this.toolCall().args?.location ?? "",
  );
}
