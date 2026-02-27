defmodule GatewayWeb.ThreadChannel do
  use GatewayWeb, :channel

  @impl true
  def join("thread:" <> token, _payload, socket) do
    with {:ok, %{thread_id: thread_id}} <- Gateway.TokenStore.consume_token(token) do
      replay = Gateway.TokenStore.token_replay(token)
      :ok = Phoenix.PubSub.subscribe(Gateway.PubSub, "thread:" <> thread_id)
      send(self(), {:dispatch_replay, replay})

      {:ok, assign(socket, token: token, thread_id: thread_id, replaying: true, pending_events: [])}
    else
      {:error, _reason} -> {:error, %{reason: "token_expired_or_used"}}
    end
  end

  @impl true
  def handle_info({:dispatch_replay, replay_events}, socket) do
    Enum.each(replay_events, fn event ->
      push(socket, "agui_event", event)
    end)

    socket =
      Enum.reduce(socket.assigns.pending_events, socket, fn event, acc ->
        push_thread_event(acc, event)
      end)
      |> assign(replaying: false, pending_events: [])

    {:noreply, socket}
  end

  @impl true
  def handle_info({:thread_event, event}, socket) do
    if socket.assigns.replaying do
      {:noreply, assign(socket, pending_events: socket.assigns.pending_events ++ [event])}
    else
      {:noreply, push_thread_event(socket, event)}
    end
  end

  defp push_thread_event(socket, event) do
    push(socket, "agui_event", event)

    case event do
      %{"type" => "RUN_FINISHED"} -> push(socket, "agui_complete", %{})
      %{"type" => "RUN_ERROR"} -> push(socket, "agui_complete", %{})
      _ -> :ok
    end

    socket
  end
end
