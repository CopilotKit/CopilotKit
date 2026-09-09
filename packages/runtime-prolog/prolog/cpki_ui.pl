:- module(cpki_ui,[ui_run/5]).
:- use_module(cpki_http).
:- use_module(cpki_a2ui).
:- use_module(cpki_mcp).
:- meta_predicate ui_run(+,+,+,2,1),ui_event(+,+,+,1,+).

%! ui_run(+Config,+Agent,+Input,:RunAgent,:Emit) is det.
%  Compose per-run UI transforms around a native or HTTP AG-UI agent.
ui_run(C,A,Input,RunAgent,Emit) :-
    scoped_servers(C,A,Servers),
    (get_dict(forwardedProps,Input,F),get_dict('__proxiedMCPRequest',F,Request)->
      mcp_proxy(Servers,Request,Result),call(Emit,_{type:"RUN_FINISHED",result:Result})
    ;(a2ui_enabled(C,A)->a2ui_prepare(C.a2ui,Input,Prepared,A2UI);A2UI=none,Prepared=Input),
     mcp_prepare(Servers,Prepared,WithMCP,MCP),Terminal=terminal(none),
     call(RunAgent,WithMCP,cpki_ui:ui_event(A2UI,MCP,Terminal,Emit)),
     arg(1,Terminal,End),
     (End==none->true;
      (A2UI==none->true;a2ui_finish(A2UI,Emit)),mcp_finish(MCP,Emit),call(Emit,End))).
ui_event(A2UI,MCP,Terminal,Emit,E) :-
    (E.type=="RUN_FINISHED"->nb_setarg(1,Terminal,E)
    ;mcp_accept(MCP,E),
     (E.type=="TOOL_CALL_RESULT"->call(Emit,E),(A2UI==none->true;a2ui_accept(A2UI,E,Emit))
     ;(A2UI==none->true;a2ui_accept(A2UI,E,Emit)),call(Emit,E))).
