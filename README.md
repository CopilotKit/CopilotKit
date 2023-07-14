![CopilotKit Banner](./assets/banner.png)

# CopilotKit

Add a powerful & customizable copilot to any app, in an afternoon.

## Installation

```bash
pnpm install @copilotkit/react-core @copilotkit/react-ui
```

## Examples


### Integrate copilot with 2 lines of code

```typescript
import { CopilotProvider } from "@copilotkit/react-core";
import { CopilotSidebarUIProvider } from "@copilotkit/react-ui";

export default function App(): JSX.Element {
  return (
    <CopilotProvider> {/* Global state & business logic. Put this around the entire app */}
      <CopilotSidebarUIProvider> {/* A built-in Copilot UI (or bring your own UI). Put this around the entire app, or around individual pages. */}
        <YourContent />
      </CopilotSidebarUIProvider>
    </CopilotProvider>
  );
}
```

### Let the copilot interact with you app (read + write)

```typescript
function DepartmentComponent(props: DepartmentComponentProps): JSX.Element {
  const { departmentData, employees } = props;

  // Give the copilot information about this department. Keep the pointer, to easily associate employees w departments.
  const departmentCopilotPointer = useMakeCopilotReadable(departmentData.description());

  // Give the copilot an entrypoint to take action on behalf of the user.
  useMakeCopilotActionable(
    {
      name: "setEmployeesAsSelected",
      description: "Set the given employees as 'selected'",
      argumentAnnotations: [
        {name: "employeeIds", type: "array", description: "The IDs of employees to set as selected", required: true}
      ],
      implementation: async (employeeIds) => setEmployeesAsSelected(employeeIds),
    },
    []
  );

  return ( // Render as usual.
    <>
      <h1>{props.departmentData.departmentName}</h1>

      <h2>Employees:</h2>

      {employees.map((employeeData) => (
        <EmployeeComponent
          employeeData={employeeData}
          departmentCopilotPointer={departmentCopilotPointer} // pass the copilot pointer
        />
      ))}
    </>
  );
}

function EmployeeComponent(props: EmployeeComponentProps): JSX.Element {
  const { employeeData, departmentCopilotPointer } = props;

  // Give the copilot information about this employee.
  useMakeCopilotReadable(employeeData.description(), departmentCopilotPointer);

  return ( // Render as usual.
    <h2>{employeeData.employeeName}</h2>
  );
}
```

## Key entrypoints:

- Implemented
  - `useMakeCopilotReadable`: give static information to the copilot, in sync with on-screen state
  - `useMakeCopilotActionable`: allow the copilot to control the state of the application

- Coming soon
  - `useMakeCopilotAskable`: let the copilot ask for additional information when needed
  - `useSetCopilotMessage`: edit the (unsent) typed user message to the copilot


## Demo

CopilotKit in action.

![Demo Gif](./assets/demo.gif)

## Contribute

Contributions are welcome! 🎉
