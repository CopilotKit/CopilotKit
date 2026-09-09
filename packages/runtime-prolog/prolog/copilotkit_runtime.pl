:- module(copilotkit_runtime, [runtime_create/2, runtime_close/1, runtime_handler/2,
                              runtime_dispatch/8, runtime_listen/3]).
:- use_module(cpki_http).
:- use_module(cpki_runner).
:- use_module(cpki_telemetry).
:- use_module(cpki_a2ui).
:- use_module(library(http/thread_httpd)).
:- use_module(library(http/http_dispatch)).
:- use_module(library(http/http_json)).
:- use_module(library(uri)).
:- dynamic configuration/2, listener/2.

%! runtime_create(+Options, -Runtime) is det.
%  Create an isolated runtime. identify_user is an application-owned predicate
%  called with the native HTTP request and an output user dict.
runtime_create(Options,R) :-
    identifier(Options.api_key),
    (get_dict(identify_user,Options,Identify),callable(Identify) -> true;throw(error(type_error(callable,identify_user),_))),
    Defaults=_{api_url:"https://api.intelligence.copilotkit.ai",runner_url:"wss://realtime.intelligence.copilotkit.ai/runner",
      client_url:"wss://realtime.intelligence.copilotkit.ai/client",base_path:"/copilotkit",agents:_{},cors_origins:[]},
    put_dict(Options,Defaults,RawConfig),
    (get_dict(a2ui,RawConfig,true)->put_dict(a2ui,RawConfig,_{},C0);C0=RawConfig),
    validate_config(C0), value(Options,telemetry,_{},TOptions),
    telemetry_create(TOptions,T),put_dict(telemetry,C0,T,Config),new_id(R),assertz(configuration(R,Config)),
    dict_pairs(Config.agents,_,Agents),length(Agents,N),telemetry_emit(T,"instance_created",_{agentsAmount:N}).

%! runtime_close(+Runtime) is det.
%  Stop accepting requests and release runtime resources.
runtime_close(R) :- close_runs(R), (configuration(R,C)->telemetry_close(C.telemetry);true), forall(retract(listener(R,Port)),http_stop_server(Port,[])),retractall(configuration(R,_)).

%! runtime_listen(+Runtime, +Options, -Port) is det.
%  Start SWI-Prolog's native HTTP host; pass port(0) to select a free port.
runtime_listen(R,Options,Port) :-
    value_port(Options,Requested), (Requested==0 -> true;Port=Requested),
    exclude(is_port,Options,Rest), http_server(copilotkit_runtime:runtime_handler(R),[port(Port)|Rest]),assertz(listener(R,Port)).
value_port(Options,P) :- (memberchk(port(P),Options)->true;P=0).
is_port(port(_)).

%! runtime_handler(+Runtime,+Request) is det.
%  Mount this handler in an existing SWI HTTP server or use runtime_listen/3.
runtime_handler(R,Request) :-
    catch((configuration(R,C),memberchk(path(Path),Request),atom_string(Path,PS),
           string_concat(C.base_path,Relative,PS),
           (Relative=="";sub_string(Relative,0,1,_,"/")),!,
           split_string(Relative,"/","/",Strings),maplist(atom_string,Segments,Strings),
           memberchk(method(Method),Request),
           (memberchk(search(Q),Request)->true;Q=[]),
           request_body(Request,Body),
           runtime_dispatch(R,Method,Segments,Q,Body,Request,Status,Reply)),
          Error, public_error(Error,Status,Reply)),
    !, response_headers(R,Request),
    (Status==204->format('Status: 204 No Content\r\n\r\n');reply_json_dict(Reply,[status(Status)])).
runtime_handler(R,Request) :- response_headers(R,Request), reply_json_dict(_{error:"Route not found"},[status(404)]).
request_body(Request,Body) :-
    (memberchk(content_length(N),Request),N>1048576 -> runtime_error(413,"Request body too large");true),
    (memberchk(content_length(N),Request),N>0 ->
       select(method(_),Request,Rest),
       catch(http_read_json_dict([method(post)|Rest],Body),_,runtime_error(400,"Invalid JSON body"));Body=_{}).
public_error(error(runtime(S,M),_),S,_{error:M}) :- !.
public_error(_,502,_{error:"Runtime dependency failed"}).

%! runtime_dispatch(+Runtime,+Method,+Segments,+Query,+Body,+Request,-Status,-Reply) is det.
%  Dispatch already-decoded requests. Identity always comes from the callback.
runtime_dispatch(_,options,_,_,_,_,204,null) :- !.
runtime_dispatch(R,M,[info],_,_,_,200,Info) :- !,
    method(M,get),configuration(R,C),runtime_info(C,Info).
runtime_dispatch(R,M,Segments,Q,B,Request,S,Reply) :-
    configuration(R,C), Identify=C.identify_user,
    (call(Identify,Request,User)->true;runtime_error(401,"Authenticated application user is required")),
    (is_dict(User),get_dict(id,User,ID),string(ID),normalize_space(string(Trim),ID),Trim\=="" -> true;runtime_error(401,"Authenticated application user is required")),
    (is_dict(B)->true;runtime_error(400,"JSON object is required")),
    dispatch(C,R,M,Segments,Q,B,User,Request,S,Reply).
method(M,Expected) :- (M==Expected->true;runtime_error(405,"Method not allowed")).
agent(C,A) :- (get_dict(A,C.agents,_)->true;runtime_error(404,"Agent not found")).
runtime_info(C,Info) :-
    catch(platform(C,get,'/api/entitlements/runtime',none,Ent),_,Ent=_{status:"unavailable"}),
    dict_pairs(C.agents,_,Agents),maplist(agent_info,Agents,Pairs),dict_pairs(Map,_,Pairs),
    telemetry_disabled(C.telemetry,Disabled),
    Base=_{version:"0.1.0",mode:"intelligence",agents:Map,intelligence:_{wsUrl:C.client_url},
       runtimeEntitlements:Ent,threadEndpoints:_{list:true,inspect:true,mutations:true,realtimeMetadata:true},
       a2uiEnabled:Enabled,openGenerativeUIEnabled:false,audioFileTranscriptionEnabled:false,suggestions:false,telemetryDisabled:Disabled},
    (a2ui_enabled(C,_)->Enabled=true,select_keys(C.a2ui,[agents],Scope),put_dict(enabled,Scope,true,A2UI),put_dict(a2ui,Base,A2UI,Info);Enabled=false,Info=Base).
agent_info(ID-Agent,ID-Info) :- atom_string(ID,Name),value(Agent,description,"",D),Info=_{name:Name,description:D,className:"PrologAgent"}.

dispatch(C,_,M,[agent,A,connect],_,B,U,_,S,Reply) :- !,
    method(M,post),telemetry_emit(C.telemetry,"copilot_request_created",_{requestType:"connect"}),agent(C,A),value(B,threadId,null,T),identifier(T),
    path([api,threads,T,connect],P),platform(C,post,P,_{userId:U.id,agentId:A},Result),
    (Result==null->S=204,Reply=null;S=200,credentials(C,Result,Reply)).
dispatch(C,R,M,[agent,A,run],_,B,U,_,200,Reply) :- !,
    method(M,post),telemetry_emit(C.telemetry,"copilot_request_created",_{requestType:"run"}),agent(C,A),
    value(B,threadId,null,T),identifier(T),value(B,runId,null,Run),identifier(Run),
    value(B,messages,null,Messages),(is_list(Messages)->true;runtime_error(400,"messages must be an array")),
    start_run(C,R,A,B,U,copilotkit_runtime:credentials,Reply).
dispatch(C,R,M,[agent,A,stop,T],_,B,U,_,200,Reply) :- !,
    method(M,post),(get_dict(runId,B,Run)->identifier(Run);true),
    path([api,threads,T],Base),query_path(Base,_{userId:U.id},P),platform(C,get,P,none,Result),
    Thread=Result.thread,
    (get_dict(agentId,Thread,Owner),atom_string(A,AS),Owner\==AS->runtime_error(403,"Thread access denied");true),
    agent(C,A),stop_run(R,Thread.id,Run,Stopped),Reply=_{stopped:Stopped}.
dispatch(C,_,M,[threads|Tail],Q,B,U,_,S,Reply) :- !,threads(C,M,Tail,Q,B,U,S,Reply).
dispatch(C,_,M,[memories|Tail],Q,B,U,Request,S,Reply) :- !,memories(C,M,Tail,Q,B,U,Request,S,Reply).
dispatch(C,_,post,[annotate],_,B,U,_,200,Reply) :- !,
    value(B,type,null,Type),identifier(Type),value(B,threadId,null,T),identifier(T),
    (get_dict(clientEventId,B,ID)->identifier(ID);new_id(ID)),
    select_keys(B,[type,threadId,payload,occurredAt],Selected),put_dict(userId,Selected,U.id,Payload),
    path([connector,annotate,ID],P),platform(C,put,P,Payload,Reply).
dispatch(_,_,_,_,_,_,_,_,_,_) :- runtime_error(404,"Route not found").
credentials(C,Result,Reply) :- select_keys(Result,[threadId,runId,joinToken],Creds),
    string_concat("thread:",Result.threadId,Topic),put_dict(realtime,Creds,_{clientUrl:C.client_url,topic:Topic},Reply).

threads(C,get,[],Q,_,U,200,Reply) :- !,
    dict_create(Query,_,Q),value(Query,agentId,null,A),
    (atom(A)->atom_string(A,AS);AS=A),identifier(AS),select_keys(Query,[agentId,includeArchived,limit,cursor],Allowed),
    put_dict(userId,Allowed,U.id,Scoped),query_path('/api/threads',Scoped,P),platform(C,get,P,none,Reply).
threads(C,post,[subscribe],_,_,U,200,Reply) :- !,platform(C,post,'/api/threads/subscribe',_{userId:U.id},Reply).
threads(C,get,[ID,Action],_,_,U,200,Reply) :- memberchk(Action,[messages,events,state]),!,
    path([api,threads,ID],Base),query_path(Base,_{userId:U.id},Check),
    (Action==messages->path([api,threads,ID,messages],MP),query_path(MP,_{userId:U.id},P)
    ;platform(C,get,Check,none,_),path([api,'_inspect',threads,ID,Action],P)),
    platform(C,get,P,none,Reply).
threads(C,M,[ID|Tail],_,B,U,200,Reply) :-
    value(B,agentId,null,A),identifier(A),select_keys(B,[agentId,name,archived],Clean),put_dict(userId,Clean,U.id,Payload),
    path([api,threads,ID],P),atom_string(ID,IDS),
    (Tail==[archive],M==post -> put_dict(archived,Payload,true,Update),platform(C,patch,P,Update,_),Reply=_{threadId:IDS,archived:true}
    ;Tail==[],M==patch->platform(C,patch,P,Payload,Result),Reply=Result.thread
    ;Tail==[],M==delete->select_keys(Payload,[userId,agentId],D),platform(C,delete,P,D,_),Reply=_{threadId:IDS,deleted:true}
    ;runtime_error(405,"Method not allowed")).

memories(C,M,Tail,Q,B,U,Request,S,Reply) :-
    (Tail=[];Tail=[_]),!,memory_headers(C,M,Tail,B,U,Request,Headers),
    select_keys(B,[content,kind,scope,sourceThreadIds,query,limit],Payload),
    validate_memory(M,Tail,Payload),path([api,memories|Tail],Base),
    (M==get -> dict_create(Query,_,Q),select_keys(Query,[scope,kind,limit,cursor],Allowed),query_path(Base,Allowed,P);P=Base),
    ((memberchk(M,[get,delete]);Tail==[subscribe]) -> Body=none;Body=Payload),
    catch(platform(C,M,P,Body,Headers,Reply),error(runtime(E,_),_),
      ((E>=500->Code=502;Code=E),runtime_error(Code,"Memory request failed"))),
    (M==delete->S=204;M==post,Tail==[]->S=201;S=200).
memories(_,_,_,_,_,_,_,_,_) :- runtime_error(404,"Route not found").
memory_headers(C,M,Tail,B,U,Request,H) :-
    Base=[request_header('x-cpki-user-id'=U.id)],
    (get_dict(memory_access,C,Callback) ->
       catch(call(Callback,U,Request,Grant),_,runtime_error(500,"Memory policy failed")),
       (Grant==null ->runtime_error(403,"Memory access is not granted");true),
       (is_dict(Grant),dict_pairs(Grant,_,[project-P,user-Us]),maplist(valid_grant,[P,Us])->true;runtime_error(500,"Invalid memory grant")),
       (P=="none",Us=="none"->runtime_error(403,"Memory access is not granted");true),
       (memberchk(M,[post,patch,delete]),\+memberchk(Tail,[[recall],[subscribe]]) ->
         (memberchk("read-write",[P,Us])->true;runtime_error(403,"Memory write access is not granted")),
         (M==post,Tail==[] -> value(B,scope,"user",Scope),(string(Scope),memberchk(Scope,["user","project"])->true;runtime_error(400,"Invalid memory scope")),atom_string(K,Scope),
           (get_dict(K,Grant,"read-write")->true;runtime_error(403,"Memory scope is not writable"));true);true),
       json_text(Grant,Text),H=[request_header('x-cpki-memory-grant'=Text)|Base]
    ;H=Base).
valid_grant(G) :- memberchk(G,["none","read","read-write"]).
validate_memory(M,Tail,B) :-
    (Tail==[recall] -> value(B,query,null,Q),identifier(Q),
      (get_dict(limit,B,L)->(integer(L),L>0->true;runtime_error(400,"Positive integer limit is required"));true)
    ;memberchk(M,[post,patch]),Tail\==[subscribe] ->
      (get_dict(content,B,Text),string(Text),get_dict(kind,B,K),memberchk(K,["topical","episodic","operational"])->true;runtime_error(400,"Memory content and kind are required"))
    ;true),
    (get_dict(scope,B,Scope)->(memberchk(Scope,["user","project"])->true;runtime_error(400,"Invalid memory scope"));true),
    (get_dict(sourceThreadIds,B,IDs)->(is_list(IDs),maplist(string,IDs)->true;runtime_error(400,"Invalid sourceThreadIds"));true).

validate_config(C) :-
    forall(member(K-Schemes,[api_url-[http,https],runner_url-[ws,wss],client_url-[ws,wss]]),
      (get_dict(K,C,URL),valid_url(URL,Schemes))),
    (is_dict(C.agents)->true;throw(error(type_error(dict,agents),_))),
    dict_pairs(C.agents,_,Agents),forall(member(_-Agent,Agents),
      (is_dict(Agent),(get_dict(run,Agent,Run),callable(Run)->true;valid_url(Agent.url,[http,https])))),
    (is_list(C.cors_origins),forall(member(Origin,C.cors_origins),(string(Origin),\+sub_string(Origin,_,_,_,"\n"),\+sub_string(Origin,_,_,_,"\r")))->true;throw(error(type_error(list,cors_origins),_))).
valid_url(URL,Schemes) :-
    uri_components(URL,Parts),uri_data(scheme,Parts,Scheme),uri_data(authority,Parts,Authority),
    (memberchk(Scheme,Schemes),nonvar(Authority),Authority\=='',\+sub_atom(Authority,_,_,_,'@')->true;throw(error(domain_error(transport_url,URL),_))).
response_headers(R,Request) :-
    format('Cache-Control: no-store\r\n'),
    (configuration(R,C),memberchk(origin(A),Request),atom_string(A,Origin),memberchk(Origin,C.cors_origins)->
       format('Access-Control-Allow-Origin: ~s\r\nVary: Origin\r\nAccess-Control-Allow-Credentials: true\r\nAccess-Control-Allow-Methods: GET, POST, PATCH, DELETE, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type, Authorization\r\n',[Origin]);true).
