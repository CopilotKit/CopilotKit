/*
 Copyright 2025 Google LLC

 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

      https://www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License.
 */

import { DynamicComponent } from '@a2ui/angular';
import * as v0_8 from '@a2ui/web-lib/0.8';
import { Component, computed, input } from '@angular/core';
import { GoogleMapsModule } from '@angular/google-maps';
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';

// --- Location Definitions ---
interface Pin {
  lat: number;
  lng: number;
  name: string;
  description: string | null;
  pinElement: google.maps.marker.PinElement;
}

export interface CustomProperties {
  path: string;
}

@Component({
  selector: 'a2ui-map',
  imports: [GoogleMapsModule, MatIconButton, MatIcon],
  styles: `
    :host {
      display: block;
      flex: var(--weight);
      padding: 20px;
    }

    .map-box-container {
      background-color: var(--mat-sys-surface-container); /* Dark background for the box */
      border-radius: 8px;
      border: 1px solid var(--mat-sys-surface-container-high); /* Subtle border for dark theme */
      padding: 20px;
      margin: 20px auto; /* Center the box */
      max-width: 800px; /* Limit width for better appearance */
    }

    /* Combined header for title and icon */
    .map-header {
      display: flex;
      justify-content: space-between; /* Pushes title to left, icon to right */
      align-items: center; /* Vertically centers title and icon */
      margin-bottom: 15px; /* Space below the header */
    }

    .map-header h2 {
      margin: 0; /* Remove default margin from h2 */
      font-size: 24px;
      color: var(--mat-sys-on-surface-container); /* Light text for title */
    }

    .header-icon {
      cursor: pointer;
      line-height: 0; /* Helps with vertical alignment of SVG */
    }

    .map-container {
      width: 100%;
      display: flex;
      flex-direction: column;
      font-family: Arial, sans-serif;
      color: #ccc; /* Light text for dark theme */
    }

    .map-container p {
      margin-bottom: 10px;
      color: #ccc; /* Light text for dark theme */
    }

    google-map {
      border: 1px solid #555; /* Dark theme border around the map */
      border-radius: 4px;
      overflow: hidden; /* Ensures border-radius applies to map content */
    }
  `,
  template: `
    @let resolvedZoom = this.resolvedZoom();

    @if (resolvedZoom) {
      <div class="map-box-container">
        <!-- Combined header for title and icon -->
        <div class="map-header">
          <h2>{{ resolvedTitle() }}</h2>
          <div>
            <button matIconButton>
              <mat-icon>download</mat-icon>
            </button>
            <button matIconButton>
              <mat-icon>share</mat-icon>
            </button>
          </div>
        </div>

        <div class="map-container">
          <google-map
            [center]="resolvedCenter()"
            [zoom]="resolvedZoom"
            height="500px"
            width="100%"
            [options]="{ mapId: mapId }"
          >
            @for (pin of resolvedPins(); track pin) {
              <map-advanced-marker
                [position]="pin"
                [content]="pin.pinElement.element"
                [title]="pin.name"
              >
              </map-advanced-marker>
            }
          </google-map>
        </div>
      </div>
    }
  `,
})
export class GoogleMap extends DynamicComponent<v0_8.Types.CustomNode> {
  private readonly maxPinCount = 100;
  private readonly defaultCenter: google.maps.LatLngLiteral = {
    lat: 34.0626,
    lng: -118.3759,
  };

  mapId = '4506f1f5f5e6e8e2';

  readonly title = input<v0_8.Primitives.StringValue | null>();
  protected resolvedTitle = computed(() => super.resolvePrimitive(this.title() ?? null));

  readonly zoom = input.required<v0_8.Primitives.NumberValue | null>();
  protected resolvedZoom = computed(() => super.resolvePrimitive(this.zoom()));

  readonly center = input.required<CustomProperties | null>();
  protected resolvedCenter = computed(() => this.resolveLatLng(this.center()));

  readonly pins = input<CustomProperties>();
  protected readonly resolvedPins = computed(() => this.resolveLocations(this.pins()));

  constructor() {
    super();
  }

  private resolveLocations(value: CustomProperties | undefined): Pin[] {
    const locations: Pin[] = [];
    if (value?.path) {
      for (let index: number = 0; index < this.maxPinCount; index++) {
        const locationPath = `${value.path}[${index}]`;
        const pin = this.resolveLocation(locationPath);
        // Stop iterating if no more locations can be found at the `locationPath`.
        if (!pin) {
          break;
        }
        locations.push(pin);
      }
    }
    return locations;
  }

  private resolveLocation(value: string | null): Pin | null {
    if (!value) {
      return null;
    }

    const latValue: v0_8.Primitives.NumberValue = { path: `${value}.lat` };
    const lngValue: v0_8.Primitives.NumberValue = { path: `${value}.lng` };
    const nameValue: v0_8.Primitives.StringValue = { path: `${value}.name` };
    const descriptionValue: v0_8.Primitives.StringValue = { path: `${value}.description` };
    const backgroundValue: v0_8.Primitives.StringValue = { path: `${value}.background` };
    const borderColorValue: v0_8.Primitives.StringValue = { path: `${value}.borderColor` };
    const glyphColorValue: v0_8.Primitives.StringValue = { path: `${value}.glyphColor` };

    const lat = this.resolvePrimitive(latValue);
    const lng = this.resolvePrimitive(lngValue);
    const name = this.resolvePrimitive(nameValue);
    const description = this.resolvePrimitive(descriptionValue);
    const background = this.resolvePrimitive(backgroundValue);
    const borderColor = this.resolvePrimitive(borderColorValue);
    const glyphColor = this.resolvePrimitive(glyphColorValue);

    // TODO: This logic should be implemented in the `guard.ts` by making the data model typed upstream.
    if (lat === null || lng === null || name === null) {
      // The location is invalid.
      return null;
    }

    return {
      lat,
      lng,
      name,
      // TODO: Description is currently not used in the Maps.
      description,
      pinElement: new google.maps.marker.PinElement({
        background,
        borderColor,
        glyphColor,
      }),
    };
  }

  private resolveLatLng(value: CustomProperties | null): google.maps.LatLngLiteral {
    if (value?.path) {
      const latValue: v0_8.Primitives.NumberValue = { path: `${value.path}.lat` };
      const lngValue: v0_8.Primitives.NumberValue = { path: `${value.path}.lng` };
      const lat = this.resolvePrimitive(latValue)!;
      const lng = this.resolvePrimitive(lngValue)!;
      return {
        lat,
        lng,
      };
    }

    return this.defaultCenter;
  }
}
