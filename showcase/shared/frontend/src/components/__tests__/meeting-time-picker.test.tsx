import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MeetingTimePicker } from "../meeting-time-picker";

const defaultSlots = [
  { date: "Tomorrow", time: "2:00 PM", duration: "30 min" },
  { date: "Friday", time: "10:00 AM", duration: "30 min" },
  { date: "Next Monday", time: "3:00 PM", duration: "30 min" },
];

describe("MeetingTimePicker", () => {
  it("renders spinner in inProgress status", () => {
    const { container } = render(
      <MeetingTimePicker status="inProgress" timeSlots={defaultSlots} />,
    );
    expect(screen.getByText("Finding available times...")).toBeTruthy();
    expect(container.querySelector(".animate-spin")).toBeTruthy();
  });

  it("shows time slot buttons in executing status", () => {
    render(<MeetingTimePicker status="executing" timeSlots={defaultSlots} />);
    expect(screen.getByText("Tomorrow")).toBeTruthy();
    expect(screen.getByText("2:00 PM")).toBeTruthy();
    expect(screen.getByText("Friday")).toBeTruthy();
    expect(screen.getByText("10:00 AM")).toBeTruthy();
    expect(screen.getByText("Next Monday")).toBeTruthy();
    expect(screen.getByText("3:00 PM")).toBeTruthy();
  });

  it("shows decline button in executing status", () => {
    render(<MeetingTimePicker status="executing" timeSlots={defaultSlots} />);
    expect(screen.getByText("None of these work")).toBeTruthy();
  });

  it("clicking a time slot calls respond", () => {
    const respond = vi.fn();
    render(
      <MeetingTimePicker
        status="executing"
        respond={respond}
        timeSlots={defaultSlots}
      />,
    );
    fireEvent.click(screen.getByText("Tomorrow").closest("button")!);
    expect(respond).toHaveBeenCalledOnce();
    expect(respond).toHaveBeenCalledWith(
      "Meeting scheduled for Tomorrow at 2:00 PM (30 min).",
    );
  });

  it("clicking decline calls respond with decline message", () => {
    const respond = vi.fn();
    render(
      <MeetingTimePicker
        status="executing"
        respond={respond}
        timeSlots={defaultSlots}
      />,
    );
    fireEvent.click(screen.getByText("None of these work"));
    expect(respond).toHaveBeenCalledOnce();
    expect(respond).toHaveBeenCalledWith(
      "The user declined all proposed meeting times. Please suggest alternative times or ask for their availability.",
    );
  });

  it("shows confirmed state after selection", () => {
    const respond = vi.fn();
    render(
      <MeetingTimePicker
        status="executing"
        respond={respond}
        timeSlots={defaultSlots}
      />,
    );
    fireEvent.click(screen.getByText("Tomorrow").closest("button")!);
    expect(screen.getByText("Meeting Scheduled")).toBeTruthy();
    expect(screen.getByText("Tomorrow at 2:00 PM")).toBeTruthy();
  });

  it("shows declined state after decline", () => {
    const respond = vi.fn();
    render(
      <MeetingTimePicker
        status="executing"
        respond={respond}
        timeSlots={defaultSlots}
      />,
    );
    fireEvent.click(screen.getByText("None of these work"));
    expect(screen.getByText("No Time Selected")).toBeTruthy();
    expect(
      screen.getByText("Looking for a better time that works for you"),
    ).toBeTruthy();
  });

  it("displays custom title via reasonForScheduling", () => {
    render(
      <MeetingTimePicker
        status="executing"
        reasonForScheduling="Sprint Planning"
        timeSlots={defaultSlots}
      />,
    );
    expect(screen.getByText("Sprint Planning")).toBeTruthy();
  });

  it("shows pick-a-time prompt in executing status", () => {
    render(<MeetingTimePicker status="executing" timeSlots={defaultSlots} />);
    expect(screen.getByText("Pick a time that works for you")).toBeTruthy();
  });
});
