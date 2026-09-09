:- module(cpki_runner,[start_run/7,stop_run/4,close_runs/1]).
:- use_module(cpki_http).
:- use_module(cpki_telemetry).
:- use_module(library(http/websocket)).
:- use_module(library(base64)).
:- use_module(library(http/http_open)).
:- use_module(library(http/http_json)).
:- use_module(library(time)).
:- dynamic active/6, cancelled/3, worker/2.

%! start_run(+Config,+Runtime,+AgentId,+Input,+User,:Credentials,-Reply) is det.
%  Own startup in a worker and return only after the Phoenix join succeeds.
start_run(C,R,A,Input,U,Credentials,Reply) :-
    message_queue_create(Ready),
    thread_create(run_worker(C,R,A,Input,U,Ready),Thread,[]),assertz(worker(R,Thread)),
    setup_call_cleanup(true,
      (thread_get_message(Ready,Result,[timeout(40)]) ->
         (Result=ready(Lock)->call(Credentials,C,Lock,Reply);Result=error(Error)->throw(Error))
       ;runtime_error(504,"Run startup timed out")),message_queue_destroy(Ready)).

run_worker(C,R,A,Input,U,Ready) :-
    catch(setup_run(C,R,A,Input,U,Ready),Error,catch(thread_send_message(Ready,error(Error)),_,true)),
    thread_self(Self),retractall(worker(R,Self)).
setup_run(C,R,A,Input,U,Ready) :-
    path([api,threads,Input.threadId],Base),query_path(Base,_{userId:U.id},Get),
    atom_string(A,AgentId), Creation=_{threadId:Input.threadId,userId:U.id,agentId:AgentId},
    catch(platform(C,get,Get,none,_),error(runtime(404,_),_),
      catch(platform(C,post,'/api/threads',Creation,_),error(runtime(409,_),_),platform(C,get,Get,none,_))),
    path([api,threads,Input.threadId,lock],LP),
    put_dict(_{runId:Input.runId,ttlSeconds:20},Creation,LockBody),
    platform(C,post,LP,LockBody,Lock),
    setup_call_cleanup(true,locked_run(C,R,A,Input,U,Lock,Ready),
        (path([api,threads,Lock.threadId,lock],Unlock),
         catch(platform(C,delete,Unlock,_{runId:Lock.runId},_),_,true))).
locked_run(C,R,A,Input,U,Lock,Ready) :-
    maplist(identifier,[Lock.threadId,Lock.runId,Lock.joinToken]),
    thread_create(lease(C,R,Lock),Lease,[]),
    setup_call_cleanup(true,
      (path([api,threads,Lock.threadId,messages],HB),query_path(HB,_{userId:U.id},HP),
       platform(C,get,HP,none,History),
       exclude(prior_message(History.messages),Input.messages,Fresh),
       put_dict(_{threadId:Lock.threadId,runId:Lock.runId},Input,Canonical),
       Gateway=gw(none,none,none,0,false),
       setup_call_cleanup(gateway_connect(C,R,Lock,Gateway),
         run_joined(C,R,A,Canonical,Fresh,Lock,Gateway,Ready),gateway_close(Gateway))),
      stop_thread(Lease)).
prior_message(History,M) :- member(P,History),get_dict(id,P,ID),get_dict(id,M,ID),!.
lease(C,R,L) :- sleep(15),
    catch((path([api,threads,L.threadId,lock],P),platform(C,patch,P,_{runId:L.runId,ttlSeconds:20},_),lease(C,R,L)),
      _,cancel_run(R,L.runId,"LOCK_RENEWAL_FAILED",_)).

run_joined(C,R,A,Input,Fresh,L,G,Ready) :-
    message_queue_create(Events,[max_size(32)]),
    assertz(active(R,L.threadId,L.runId,Events,none,running)),
    thread_send_message(Ready,ready(L)),
    telemetry_emit(C.telemetry,"agent_execution_stream_started",_{}),
    nb_setval(cpki_sequence,0),nb_setval(cpki_open_messages,[]),nb_setval(cpki_open_tools,[]),
    setup_call_cleanup(true,
      catch((put_dict(messages,Input,Fresh,Saved),publish(C,R,L,G,[_{type:"RUN_STARTED",input:Saved}]),
        thread_create(produce(C,A,Input,Events),Producer,[]),
        with_mutex(cpki_runs,(retract(active(R,L.threadId,L.runId,Events,none,running)),assertz(active(R,L.threadId,L.runId,Events,Producer,running)))),
        (cancelled(R,L.runId,_)->stop_thread(Producer);true),
        consume(C,R,L,G,Events)),
       _,catch(publish(C,R,L,G,[_{type:"RUN_ERROR",code:"AGENT_RUN_FAILED",message:"Agent run failed"}]),_,true)),
      (retract(active(R,L.threadId,L.runId,Events,P,_)),stop_thread(P),message_queue_destroy(Events),retractall(cancelled(R,L.runId,_)))).
produce(C,A,Input,Q) :-
    catch((get_dict(A,C.agents,Agent),
      (get_dict(run,Agent,Callback)->call(Callback,Input,cpki_runner:queue_event(Q));http_agent(Agent,Input,Q)),
      thread_send_message(Q,done)),Error,catch(thread_send_message(Q,error(Error)),_,true)).
queue_event(Q,E) :- thread_send_message(Q,event(E)).
http_agent(Agent,Input,Q) :- json_text(Input,Text),
    value(Agent,headers,_{},Headers),dict_pairs(Headers,_,Pairs),maplist(request_header,Pairs,Options),
    append([post(string('application/json',Text)),request_header('Accept'='text/event-stream'),timeout(120),status_code(Status),redirect(false)],Options,Opts),
    setup_call_cleanup(http_open(Agent.url,S,Opts),
      (between(200,299,Status)->sse_events(S,queue_event(Q));runtime_error(502,"Agent request failed")),close(S)).
request_header(K-V,request_header(K=V)).
consume(C,R,L,G,Q) :-
    (cancelled(R,L.runId,Code)-> publish(C,R,L,G,[_{type:"RUN_ERROR",code:Code,message:"Run stopped"}])
    ; thread_get_message(Q,Item,[timeout(0.05)]) -> consume_item(Item,C,R,L,G,Q)
    ; consume(C,R,L,G,Q)).
consume_item(event(E),C,R,L,G,Q) :- !,
    (E.type=="RUN_STARTED" -> consume(C,R,L,G,Q)
    ;gather(G,Q,[E],Batch),publish(C,R,L,G,Batch),
     (last(Batch,Last),memberchk(Last.type,["RUN_FINISHED","RUN_ERROR"])->true;consume(C,R,L,G,Q))).
consume_item(done,C,R,L,G,_) :- !,incomplete_events(Events),publish(C,R,L,G,Events).
consume_item(error(E),_,_,_,_,_) :- throw(E).
gather(G,Q,Batch,Result) :-
    arg(5,G,true),length(Batch,N),N<32,last(Batch,Last),\+memberchk(Last.type,["RUN_FINISHED","RUN_ERROR"]),
    thread_get_message(Q,event(Next),[timeout(0)]),!,
    (Next.type=="RUN_STARTED"->More=Batch;append(Batch,[Next],More)),gather(G,Q,More,Result).
gather(_,_,B,B).

%! stop_run(+Runtime,+CanonicalThread,+OptionalRun,-Stopped) is det.
%  Cancel only a current matching run; finish its pending durable push first.
stop_run(R,T,Run,Stopped) :-
    (active(R,T,ID,_,_,running),(var(Run);Run==ID)->cancel_run(R,ID,"STOPPED",Stopped);Stopped=false).
cancel_run(R,ID,Code,Stopped) :- with_mutex(cpki_runs,
    ((active(R,_,ID,_,Producer,running),\+cancelled(R,ID,_)) ->
       assertz(cancelled(R,ID,Code)),Stopped=true;Producer=none,Stopped=false)),
    (Stopped==true->stop_thread(Producer);true).
close_runs(R) :- forall(active(R,_,ID,_,_,_),cancel_run(R,ID,"STOPPED",_)),
    forall(worker(R,T),(catch(call_with_time_limit(10,thread_join(T,_)),_,stop_thread(T)))).
stop_thread(none) :- !.
stop_thread(T) :- catch(thread_signal(T,throw(cpki_cancelled)),_,true),catch(thread_join(T,_),_,true).

%! gateway_connect(+Config,+Runtime,+Lock,+Gateway) is det.
%  Negotiate Phoenix V2 and retry a draining gateway with bounded backoff.
gateway_connect(C,R,L,G) :- connect_attempt(C,R,L,G,0).
connect_attempt(C,R,L,G,N) :-
    catch(connect_once(C,R,L,G),E,
      (gateway_close(G),N<3,E\=error(permanent_gateway,_)->sleep(0.1),N1 is N+1,connect_attempt(C,R,L,G,N1);throw(E))).
connect_once(C,R,L,G) :-
    atomics_to_string([C.runner_url,"/websocket?vsn=2.0.0"],URL),
    base64_encoded(C.api_key,B64,[as(atom),charset(url),padding(false)]),atom_concat('base64url.bearer.phx.',B64,Bearer),
    http_open_websocket(URL,WS,[subprotocols([phoenix,Bearer]),timeout(5)]),
    nb_setarg(1,G,WS),message_queue_create(Replies,[max_size(64)]),nb_setarg(3,G,Replies),
    thread_create(receive_gateway(WS,Replies,R,L.runId),Reader,[]),nb_setarg(2,G,Reader),
    exchange(G,L,"phx_join",_{thread_id:L.threadId,run_id:L.runId},Reply),
    (Reply.status=="ok"->value(Reply,response,_{},Response),value(Response,capabilities,[],Caps),
      (memberchk("runner_event_batch_v1",Caps)->nb_setarg(5,G,true);nb_setarg(5,G,false))
    ;get_dict(response,Reply,Res),get_dict(retryable,Res,true)->throw(error(retry_gateway,_))
    ;throw(error(permanent_gateway,_))).
receive_gateway(WS,Q,R,Run) :-
    catch(receive_loop(WS,Q,R,Run),_,catch(thread_send_message(Q,closed,[timeout(0)]),_,true)).
receive_loop(WS,Q,R,Run) :-
    ws_receive(WS,Message,[format(json)]),
    (Message.opcode==close->thread_send_message(Q,closed)
    ;Message.data=[_,_,_,"ag-ui",Payload],is_dict(Payload),get_dict(name,Payload,"stop")->
       cancel_run(R,Run,"STOPPED",_),receive_loop(WS,Q,R,Run)
    ;thread_send_message(Q,Message.data,[timeout(0)]),receive_loop(WS,Q,R,Run)).
gateway_close(G) :-
    arg(1,G,WS),arg(2,G,T),arg(3,G,Q),
    (WS==none->true;catch(close(WS,[force(true)]),_,true)),stop_thread(T),
    (Q==none->true;catch(message_queue_destroy(Q),_,true)),
    nb_setarg(1,G,none),nb_setarg(2,G,none),nb_setarg(3,G,none).
exchange(G,L,Name,Payload,Reply) :-
    arg(4,G,N),Next is N+1,nb_setarg(4,G,Next),number_string(Next,Ref),
    string_concat("ingestion:",L.runId,Topic),arg(1,G,WS),arg(3,G,Q),
    ws_send(WS,json(["1",Ref,Topic,Name,Payload])),
    call_with_time_limit(5,await_reply(Q,Ref,Reply)).
await_reply(Q,Ref,Reply) :- thread_get_message(Q,Message),
    (Message==closed->throw(error(gateway_closed,_))
    ;Message=[_,Ref,_,"phx_reply",Reply]->true;await_reply(Q,Ref,Reply)).

publish(C,R,L,G,Sources) :-
    maplist(canonical_event(L),Sources,Events),
    (member(E,Events),memberchk(E.type,["RUN_FINISHED","RUN_ERROR"])->
       with_mutex(cpki_runs,(retract(active(R,T,L.runId,Q,P,running))->assertz(active(R,T,L.runId,Q,P,terminal));true));true),
    publish_attempt(C,R,L,G,Events,0),maplist(track_event,Events),
    (member(E,Events),E.type=="RUN_FINISHED"->telemetry_emit(C.telemetry,"agent_execution_stream_ended",_{})
    ;member(E,Events),E.type=="RUN_ERROR"->telemetry_emit(C.telemetry,"agent_execution_stream_errored",_{});true).
canonical_event(L,Source,E) :- nb_getval(cpki_sequence,N),Next is N+1,nb_setval(cpki_sequence,Next),new_id(ID),
    value(Source,metadata,_{},Meta0),(is_dict(Meta0)->Meta=Meta0;Meta=_{}),
    put_dict(_{cpki_event_id:ID,cpki_event_seq:Next},Meta,M),
    put_dict(_{threadId:L.threadId,runId:L.runId,thread_id:L.threadId,run_id:L.runId,metadata:M},Source,E).
publish_attempt(C,R,L,G,Events,N) :-
    catch((arg(5,G,Batch),(Batch==true->push(G,L,"events",_{events:Events});maplist(push_one(G,L),Events))),E,
      (N<3,E\=error(permanent_gateway,_)->gateway_close(G),Delay is 0.1*2^N,sleep(Delay),
       gateway_connect(C,R,L,G),N1 is N+1,publish_attempt(C,R,L,G,Events,N1);throw(E))).
push_one(G,L,E) :- push(G,L,"event",E).
push(G,L,Name,Payload) :- exchange(G,L,Name,Payload,Reply),
    (Reply.status=="ok"->true
    ;get_dict(response,Reply,Response),get_dict(retryable,Response,false)->throw(error(permanent_gateway,_))
    ;throw(error(retry_gateway,_))).
track_event(E) :-
    (E.type=="TEXT_MESSAGE_START"->nb_getval(cpki_open_messages,M),nb_setval(cpki_open_messages,[E.messageId|M])
    ;E.type=="TEXT_MESSAGE_END"->nb_getval(cpki_open_messages,M),delete(M,E.messageId,N),nb_setval(cpki_open_messages,N)
    ;E.type=="TOOL_CALL_START"->nb_getval(cpki_open_tools,T),nb_setval(cpki_open_tools,[E.toolCallId-false-false|T])
    ;memberchk(E.type,["TOOL_CALL_END","TOOL_CALL_RESULT"])->nb_getval(cpki_open_tools,T),maplist(update_tool(E),T,N),nb_setval(cpki_open_tools,N)
    ;true).
update_tool(E,ID-End-Result,ID-NewEnd-NewResult) :-
    (ID==E.toolCallId,E.type=="TOOL_CALL_END"->NewEnd=true;NewEnd=End),
    (ID==E.toolCallId,E.type=="TOOL_CALL_RESULT"->NewResult=true;NewResult=Result).
incomplete_events(Events) :-
    nb_getval(cpki_open_messages,Messages),findall(_{type:"TEXT_MESSAGE_END",messageId:ID},member(ID,Messages),Ends),
    nb_getval(cpki_open_tools,Tools),findall(E,(member(ID-End-Result,Tools),
      (End==false,E=_{type:"TOOL_CALL_END",toolCallId:ID}
      ;Result==false,new_id(M),json_text(_{reason:"missing_terminal_event",status:"error"},Text),E=_{type:"TOOL_CALL_RESULT",messageId:M,toolCallId:ID,content:Text})),ToolEnds),
    append([Ends,ToolEnds,[_{type:"RUN_ERROR",code:"INCOMPLETE_STREAM",message:"Run ended without a terminal event"}]],Events).
