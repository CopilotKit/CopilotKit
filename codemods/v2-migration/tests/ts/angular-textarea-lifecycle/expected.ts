import type { AfterViewInit } from "@angular/core";
import { Component } from "@angular/core";
import { CopilotChatTextarea as BaseTextarea } from "@copilotkit/angular";

@Component({ selector: "textarea[appTextarea]", template: "" })
export class AppTextarea extends BaseTextarea implements AfterViewInit {
  ngAfterViewInit(): void {
    console.log("ready");
  }
}

// An unrelated base class keeps its lifecycle call.
class Base {
  ngAfterViewInit() {}
}
export class Other extends Base {
  override ngAfterViewInit(): void {
    super.ngAfterViewInit();
  }
}
