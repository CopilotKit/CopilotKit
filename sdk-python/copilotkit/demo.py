import threading
import queue
import uuid

# 1) CREW AI / LIBRARY IMPORTS
#    (Pretend these come from some library you don't fully control)
from crewai.flow.flow import Flow, start, listen
from litellm import completion

##############################################################################
# 2) THREAD-LOCAL UTILITIES
##############################################################################
THREAD_LOCAL = threading.local()

def set_thread_local_queue(q: queue.Queue):
    """
    Store a queue in this thread's local storage.
    """
    THREAD_LOCAL.queue = q

def get_thread_local_queue() -> queue.Queue:
    """
    Retrieve the queue from this thread's local storage (or None if missing).
    """
    return getattr(THREAD_LOCAL, "queue", None)

##############################################################################
# 3) LIBRARY FUNCTION THAT EMITS A TOOL CALL WITHOUT EXPLICIT QUEUE
##############################################################################
def copilotkit_emit_tool_call(msg: str):
    """
    Called deep within the library. We do NOT accept a queue argument;
    we automatically fetch it from this thread's thread-local storage.
    """
    local_queue = get_thread_local_queue()
    if local_queue is None:
        raise RuntimeError("No thread-local queue is set in this thread!")
    local_queue.put(msg)

##############################################################################
# 4) FLOW DEFINITION (CALLS THE LIBRARY EMIT FUNCTION)
##############################################################################
class ExampleFlow(Flow):
    @start()
    def chat(self):
        print("Starting flow")
        print(f"Flow State ID: {self.state['id']}")

        # Suppose the library does an asyncio-based call under the hood:
        response = completion(
            model="gpt-4o",
            messages=self.state["messages"],
        )
        message = response["choices"][0]["message"]
        print(f"Message: {message}")
        self.state["messages"].append(message)

        # Generate a tool call event behind the scenes
        copilotkit_emit_tool_call(f"Flow says hello – ID: {uuid.uuid4()}")

        return "Vienna"

    @listen(chat)
    def generate_fun_fact(self, random_city):
        print(f"Generating fun fact for {random_city}")
##############################################################################
# 5) WORKER THREAD FUNCTION
##############################################################################
def flow_thread_runner(my_queue: queue.Queue):
    """
    Runs in the dedicated worker thread. We:
      - "Import" the main thread's thread-local dict into this thread's THREAD_LOCAL.
      - Create/run the flow, which calls 'copilotkit_emit_tool_call(...)'.
      - Finally, queue a "DONE" message to signal completion.
    """

    # Copy the main thread's local dictionary into this worker thread's local dict
    set_thread_local_queue(my_queue)

    # Now get_thread_local_queue() will return the same queue object the main thread created
    flow = ExampleFlow()

    def subscriber(sender, event):
        print(f"!!!! Got a signal sent by {sender!r}")
        print(f"!!!! Event: {event}")

    flow.event_emitter.connect(subscriber)

    flow.kickoff({"messages": [{"role": "user", "content": "Hello"}]})

    # Signal the main thread that we're finished
    local_queue = get_thread_local_queue()
    local_queue.put("DONE")

##############################################################################
# 6) MAIN THREAD (NO ASYNCIO)
##############################################################################
def main():
    # (a) Create the queue in the main thread
    my_queue = queue.Queue()

    # (c) Spawn a worker thread, passing a copy of the main thread's local dict
    t = threading.Thread(
        target=flow_thread_runner,
        args=(my_queue,),
        daemon=False
    )
    t.start()

    # (d) Read from the queue until we see "DONE"
    while True:
        item = my_queue.get()  # blocking read
        my_queue.task_done()
        if item == "DONE":
            print("[MAIN THREAD] Received DONE sentinel. Flow is complete.")
            break
        else:
            print(f"[MAIN THREAD] Received message: {item}")

    # (e) Cleanup
    t.join()
    print("All done. Exiting.")

if __name__ == "__main__":
    main()
