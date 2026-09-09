:- module(cpki_mcp,[mcp_prepare/4,mcp_accept/2,mcp_finish/2,mcp_proxy/3,scoped_servers/3,server_hash/2]).
:- use_module(cpki_http).
:- use_module(library(http/http_open)).
:- use_module(library(http/http_json)).
:- use_module(library(md5)).
:- meta_predicate mcp_finish(+,1), with_client(+,1).

%! scoped_servers(+RuntimeConfig,+Agent,-Servers) is det.
%  MCP URLs and headers come only from trusted server configuration.
scoped_servers(C,A,Servers) :- value(C,mcp_apps,_{},MCP),value(MCP,servers,[],All),include(in_scope(A),All,Servers).
in_scope(A,Server) :- (get_dict(agentId,Server,ID)->atom_string(A,ID);true).
server_hash(S,Hash) :- json_text(_{type:S.type,url:S.url},Text),md5_hash(Text,A,[encoding(utf8)]),atom_string(A,Hash).

with_client(Server,Goal) :-
    Client=client(Server,none,"2025-03-26",0),
    setup_call_cleanup(true,(connect(Client),call(Goal,Client)),close_client(Client)).
connect(Client) :-
    rpc(Client,"initialize",_{protocolVersion:"2025-03-26",
      capabilities:_{extensions:_{'io.modelcontextprotocol/ui':_{mimeTypes:["text/html+mcp"]}}},
      clientInfo:_{name:"copilotkit-runtime-prolog",version:"0.1.0"}},Result),
    (is_dict(Result),get_dict(protocolVersion,Result,V),string(V)->nb_setarg(3,Client,V);runtime_error(502,"Invalid MCP initialization")),
    rpc(Client,"notifications/initialized",none,_).
close_client(Client) :- arg(2,Client,Session),
    (Session==none->true;catch(transport(Client,delete,none,none,_),_,true)).
rpc(Client,Method,Params,Result) :-
    arg(4,Client,N),Next is N+1,nb_setarg(4,Client,Next),
    (sub_string(Method,0,14,_,"notifications/")->ID=none,Envelope=_{jsonrpc:"2.0",method:Method}
    ;ID=Next,Envelope=_{jsonrpc:"2.0",id:ID,method:Method}),
    (Params==none->Body=Envelope;put_dict(params,Envelope,Params,Body)),
    transport(Client,post,Body,ID,Response),
    (ID==none->Result=_{success:true}
    ;is_dict(Response),Response.id==ID,Response.jsonrpc=="2.0",\+get_dict(error,Response,_),get_dict(result,Response,Result)->true
    ;runtime_error(502,"MCP request failed")).
transport(Client,Method,Body,ID,Result) :-
    arg(1,Client,Server),arg(2,Client,Session),arg(3,Client,Version),
    (Server.type=="http"->true;runtime_error(502,"Only MCP Streamable HTTP is supported")),
    value(Server,headers,_{},Headers),dict_pairs(Headers,_,Pairs),maplist(header,Pairs,Trusted),
    (Session==none->SessionHeader=[];SessionHeader=[request_header('Mcp-Session-Id'=Session)]),
    (Body==none->Post=[];json_text(Body,Text),Post=[post(string('application/json',Text))]),
    append([[method(Method),timeout(10),redirect(false),status_code(Status),
       header(content_type,Type),header(mcp_session_id,NewSession),
       request_header('Accept'='application/json, text/event-stream'),request_header('MCP-Protocol-Version'=Version)],Trusted,SessionHeader,Post],Options),
    setup_call_cleanup(http_open(Server.url,S,Options),
      ((between(200,299,Status)->true;runtime_error(502,"MCP transport failed")),
       (atom(NewSession),NewSession\==''->nb_setarg(2,Client,NewSession);true),
       (ID==none->Result=null
       ;sub_atom(Type,0,_,_,'text/event-stream')->
          catch((sse_events(S,rpc_event(ID)),runtime_error(502,"Missing MCP response")),mcp_response(Result),true)
       ;read_string(S,4194305,Raw),string_length(Raw,Size),
        (Size=<4194304->atom_json_dict(Raw,Result,[]);runtime_error(502,"MCP response exceeded size limit")))),close(S)).
header(K-V,request_header(K=V)).
rpc_event(ID,Event) :- (is_dict(Event),get_dict(id,Event,ID)->throw(mcp_response(Event));true).

%! mcp_proxy(+Servers,+Request,-Result) is det.
%  Validate the method and registered server before opening any connection.
mcp_proxy(Servers,Request,Result) :-
    catch((is_dict(Request),get_dict(method,Request,Method),
      memberchk(Method,["tools/call","resources/read","notifications/message","ping"]),
      member(Server,Servers),matches_server(Request,Server),!,value(Request,params,none,Params),
      with_client(Server,proxy_call(Method,Params,Result))),_,fail),!.
mcp_proxy(_,_,_{error:"MCP proxy request rejected or failed"}).
matches_server(R,S) :- (get_dict(serverId,R,ID),get_dict(serverId,S,ID)->true;get_dict(serverHash,R,H),server_hash(S,H)).
proxy_call(Method,Params,Result,Client) :- rpc(Client,Method,Params,Result).

%! mcp_prepare(+Servers,+Input,-Prepared,-State) is det.
%  Advertise UI tools only and retain prior tool results to prevent duplicate calls.
mcp_prepare(Servers,Input,Prepared,State) :-
    findall(Entries,(member(Server,Servers),with_client(Server,list_tools(Server,Entries))),Groups),append(Groups,Tools),
    unique_tools(Tools),findall(Name,member(Name-_,Tools),Names),
    value(Input,tools,[],Original),exclude(tool_named(Names),Original,Other),
    findall(T,(member(_-Info,Tools),T=Info.tool),Public),append(Other,Public,Combined),
    put_dict(tools,Input,Combined,Prepared),
    value(Input,messages,[],Messages),
    findall(ID,(member(M,Messages),get_dict(role,M,"tool"),get_dict(toolCallId,M,ID)),Resolved),
    findall(ID-_{name:Name,args:Args},(member(M,Messages),get_dict(toolCalls,M,Calls),member(Call,Calls),ID=Call.id,F=Call.function,Name=F.name,value(F,arguments,"",Args)),Prior),
    State=mcp(Tools,Prior,Resolved).
tool_named(Names,T) :- memberchk(T.name,Names).
list_tools(Server,Tools,Client) :- list_pages(Client,Server,none,0,Tools).
list_pages(Client,Server,Cursor,N,Tools) :-
    (N>=32->runtime_error(502,"MCP pagination limit exceeded");true),
    (Cursor==none->Params=_{};Params=_{cursor:Cursor}),rpc(Client,"tools/list",Params,Result),
    (is_dict(Result),is_list(Result.tools)->true;runtime_error(502,"Invalid MCP tool listing")),
    findall(Name-_{server:Server,resource:Resource,tool:Public},
      (member(T,Result.tools),is_dict(T),get_dict('_meta',T,Meta),
       (get_dict('ui/resourceUri',Meta,Resource);get_dict(ui,Meta,UI),get_dict(resourceUri,UI,Resource)),
       string(Resource),Name=T.name,value(T,description,"",D),format(string(Description),'~s\n[UI Resource: ~s]',[D,Resource]),
       value(T,inputSchema,_{type:"object",properties:_{}},Schema),Public=_{name:Name,description:Description,parameters:Schema}),Page),
    (get_dict(nextCursor,Result,Next),Next\==null->N1 is N+1,list_pages(Client,Server,Next,N1,Rest),append(Page,Rest,Tools);Tools=Page).
mcp_accept(State,E) :-
    (E.type=="TOOL_CALL_START" ->arg(2,State,Calls),nb_setarg(2,State,[E.toolCallId-_{name:E.toolCallName,args:""}|Calls])
    ;E.type=="TOOL_CALL_ARGS" ->arg(2,State,Calls),
      (select(E.toolCallId-Call,Calls,Rest)->string_concat(Call.args,E.delta,Args),string_length(Args,N),
       (N=<1048576->true;runtime_error(502,"MCP arguments exceeded size limit")),put_dict(args,Call,Args,New),nb_setarg(2,State,[E.toolCallId-New|Rest]);true)
    ;E.type=="TOOL_CALL_RESULT"->arg(3,State,Resolved),nb_setarg(3,State,[E.toolCallId|Resolved]);true).
mcp_finish(State,Emit) :- arg(1,State,Tools),arg(2,State,Calls),arg(3,State,Resolved),
    forall((member(ID-Call,Calls),member(Call.name-Info,Tools),\+memberchk(ID,Resolved)),finish_call(ID,Call,Info,Emit)).
finish_call(ID,Call,Info,Emit) :-
    catch((atom_json_dict(Call.args,Args,[]),(is_dict(Args)->true;runtime_error(400,"MCP arguments must be an object")),
      with_client(Info.server,proxy_call("tools/call",_{name:Call.name,arguments:Args},Result)),
      value(Result,content,[],Content),findall(T,(member(C,Content),is_dict(C),get_dict(type,C,"text"),get_dict(text,C,T)),Texts),
      (Texts=[]->json_text(Content,Text);atomics_to_string(Texts,"\n",Text)),
      new_id(M),call(Emit,_{type:"TOOL_CALL_RESULT",messageId:M,toolCallId:ID,content:Text}),
      server_hash(Info.server,Hash),Base=_{result:Result,resourceUri:Info.resource,serverHash:Hash,toolInput:Args},
      (get_dict(serverId,Info.server,ServerID)->put_dict(serverId,Base,ServerID,Activity);Activity=Base),
      new_id(A),call(Emit,_{type:"ACTIVITY_SNAPSHOT",messageId:A,activityType:"mcp-apps",content:Activity,replace:true})),
    _,(new_id(M),json_text(_{error:"MCP tool execution failed"},Text),call(Emit,_{type:"TOOL_CALL_RESULT",messageId:M,toolCallId:ID,content:Text}))).

unique_tools(Tools) :- findall(Name,member(Name-_,Tools),Names),sort(Names,Unique),
    length(Names,N),length(Unique,M),(N=:=M->true;runtime_error(502,"Duplicate MCP UI tool name")).
