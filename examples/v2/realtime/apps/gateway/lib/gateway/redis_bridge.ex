defmodule Gateway.RedisBridge do
  use GenServer

  @pattern "ck:thread:*:pubsub"

  def start_link(_args) do
    GenServer.start_link(__MODULE__, %{}, name: __MODULE__)
  end

  @impl true
  def init(state) do
    {:ok, _subscription_ref} =
      Redix.PubSub.psubscribe(Gateway.RedixPubSub, [@pattern], self())

    {:ok, state}
  end

  @impl true
  def handle_info(
        {:redix_pubsub, Gateway.RedixPubSub, :pmessage, %{payload: payload}},
        state
      ) do
    with {:ok, %{"threadId" => thread_id, "event" => event}} <- Jason.decode(payload),
         true <- is_binary(thread_id) do
      Phoenix.PubSub.broadcast(Gateway.PubSub, "thread:" <> thread_id, {:thread_event, event})
    else
      _ -> :ok
    end

    {:noreply, state}
  end

  @impl true
  def handle_info(_message, state), do: {:noreply, state}
end
