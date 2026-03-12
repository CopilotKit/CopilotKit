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

import { ModelProcessor, Surface } from '@a2ui/angular';
import * as v0_8 from '@a2ui/web-lib/0.8';
import { Component, inject, signal } from '@angular/core';
import { Client } from './client';

@Component({
  selector: 'app-root',
  templateUrl: './app.html',
  styleUrl: 'app.css',
  imports: [Surface],
})
export class App {
  protected client = inject(Client);
  protected processor = inject(ModelProcessor);

  protected hasData = signal(false);

  protected async handleSubmit(event: SubmitEvent) {
    event.preventDefault();

    if (!(event.target instanceof HTMLFormElement)) {
      return;
    }

    const data = new FormData(event.target);
    const body = data.get('body') ?? null;

    if (body) {
      const message = body as v0_8.Types.A2UIClientEventMessage;
      await this.client.makeRequest(message);
      this.hasData.set(true);
    }
  }
}
