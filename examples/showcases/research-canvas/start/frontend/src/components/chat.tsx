"use client";

export default function Chat({
  onSubmitMessage: _onSubmitMessage,
}: {
  onSubmitMessage: () => void;
}) {
  return (
    <h1 className="text-2xl font-bold flex items-center justify-center h-full mx-auto mr-20">
      It'd be really cool if we had chat here!
    </h1>
  );
}
