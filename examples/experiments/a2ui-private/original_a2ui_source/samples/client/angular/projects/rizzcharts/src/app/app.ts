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

import { Component, Inject, OnInit, Renderer2, inject, signal } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { RouterOutlet } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { A2aChatCanvas } from '@a2a_chat_canvas/a2a-chat-canvas';
import { ChatService } from '@a2a_chat_canvas/services/chat-service';
import { Toolbar } from '@rizzcharts/components/toolbar/toolbar';
import { environment } from '@rizzcharts/environments/environment';
import { A2aService } from '@rizzcharts/services/a2a_service'

@Component({
  selector: 'app-root',
  imports: [A2aChatCanvas, RouterOutlet, Toolbar, MatButtonModule],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App implements OnInit {
  protected readonly agentName = signal('');
  readonly chatService = inject(ChatService);
  private readonly a2aService = inject(A2aService);

  
  constructor(
    private _renderer2: Renderer2,
    @Inject(DOCUMENT) private _document: Document
  ) {}

  ngOnInit() {
    const script = this._renderer2.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${environment.googleMapsApiKey}&callback=initMap&libraries=marker`;
    script.async = true;
    script.defer = true;
    this._renderer2.appendChild(this._document.body, script);
    this.a2aService.getAgentCard().then((card) => {
      this.agentName.set(card.name);
    });
  }

  sendMessage(text: string) {
    this.chatService.sendMessage(text);
  }
}
