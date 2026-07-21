import { Component } from "@angular/core";
import { CopilotChat } from "@copilotkit/angular";

@Component({
  selector: "app-root",
  standalone: true,
  imports: [CopilotChat],
  template: `<div style="height:100vh"><copilot-chat /></div>`,
})
export class App {}
