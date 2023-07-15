import {
  useMakeCopilotActionable,
  useMakeCopilotReadable,
} from "@copilotkit/react-core";
import React from "react";

class DepartmentData {
  departmentName: string;

  constructor(departmentName: string) {
    this.departmentName = departmentName;
  }

  description() {
    return `Department: ${this.departmentName}`;
  }
}

interface DepartmentComponentProps {
  departmentData: DepartmentData;
  employees: EmployeeData[];
}

class EmployeeData {
  employeeName: string;

  constructor(employeeName: string) {
    this.employeeName = employeeName;
  }

  description() {
    return `Employee: ${this.employeeName}`;
  }
}

interface EmployeeComponentProps {
  employeeData: EmployeeData;
  departmentCopilotPointer: string;
}

function setEmployeesAsSelected(employeeIds: string[]) {
  // ...
}

function DepartmentComponent(props: DepartmentComponentProps): JSX.Element {
  const { departmentData, employees } = props;

  // Give the copilot information about this department.
  // Keep the pointer, to easily associate employees w departments later on:
  const departmentCopilotPointer = useMakeCopilotReadable(
    departmentData.description()
  );

  // Give the copilot an entrypoint to take action on behalf of the user:
  useMakeCopilotActionable(
    {
      name: "setEmployeesAsSelected",
      description: "Set the given employees as 'selected'",
      argumentAnnotations: [
        {
          name: "employeeIds",
          type: "array",
          description: "The IDs of employees to set as selected",
          required: true,
        },
      ],
      implementation: async (employeeIds) =>
        setEmployeesAsSelected(employeeIds),
    },
    []
  );

  return (
    // Render as usual.
    <>
      <h1>{props.departmentData.departmentName}</h1>

      <h2>Employees:</h2>
      {employees.map((employeeData) => (
        <EmployeeComponent
          key={employeeData.employeeName}
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

  return (
    // Render as usual.
    <h2>{employeeData.employeeName}</h2>
  );
}
