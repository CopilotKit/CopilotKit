from agent import ProverbsState, StateDeps, agent

app = agent.to_ag_ui(deps=StateDeps(ProverbsState()))

if __name__ == "__main__":
    # run the app
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
