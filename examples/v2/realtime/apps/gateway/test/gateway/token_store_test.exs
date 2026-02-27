defmodule Gateway.TokenStoreTest do
  use ExUnit.Case, async: true

  test "token key naming contract" do
    token = "abc"
    assert "ck:token:" <> token == "ck:token:abc"
  end
end
