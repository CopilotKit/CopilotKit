:- module(cpki_a2ui,[a2ui_prepare/4,a2ui_accept/3,a2ui_finish/2,a2ui_enabled/2,
                    validate_components/3,json_field/3,partial_array/3]).
:- use_module(cpki_http).
:- use_module(library(http/json)).
:- use_module(library(dcg/basics)).
:- meta_predicate a2ui_accept(+, +, 1), a2ui_finish(+,1).

schema_description("A2UI Component Schema — available components for generating UI surfaces. Use these component names and properties when creating A2UI operations.").
basic_catalog("https://a2ui.org/specification/v0_9/basic_catalog.json").
a2ui_enabled(C,A) :- get_dict(a2ui,C,Config),Config\==false,Config\==null,
    \+get_dict(enabled,Config,false),
    (var(A)->true;\+get_dict(agents,Config,_)->true;atom_string(A,Name),memberchk(Name,Config.agents)).

%! a2ui_prepare(+Config,+Input,-Prepared,-State) is det.
%  Keep render state local to the producer and inject only host-owned settings.
a2ui_prepare(Config,Input,Prepared,State) :-
    value(Config,injectA2UITool,false,Inject),
    (string(Inject)->Tool=Inject;Tool="render_a2ui"),
    value(Config,a2uiToolNames,["render_a2ui"],Names0),
    (Inject\==false->sort([Tool|Names0],Names);Names=Names0),
    value(Input,context,[],Context),schema_description(Description),
    (member(Entry,Context),Entry.description==Description,
      catch(atom_json_dict(Entry.value,Frontend,[]),_,fail),get_dict(catalogId,Frontend,Catalog)->true;Catalog=null),
    State=a2ui(Config,Names,[],[],none,Catalog),
    action_input(Input,ActionInput),
    (get_dict(schema,Config,Schema)->exclude(schema_context,Context,Other),json_text(Schema,Text),
      append(Other,[_{description:Description,value:Text}],Contexts);Contexts=Context),
    (Inject\==false -> value(Input,tools,[],Tools),exclude(named_tool(Tool),Tools,Others),
      Render=_{name:Tool,description:"Render a dynamic A2UI v0.9 surface with structured parameters.",
       parameters:_{type:"object",properties:_{surfaceId:_{type:"string"},components:_{type:"array",items:_{type:"object"}},data:_{type:"object"}},required:["surfaceId","components"]}},
      append(Others,[Render],WithTool),value(ActionInput,forwardedProps,_{},F),put_dict(injectA2UITool,F,Inject,Props),
      string_concat("A2UI render tool usage guide — how to call ",Tool,D0),string_concat(D0," with valid arguments.",Guide),
      append(Contexts,[_{description:Guide,value:"Use flat v0.9 components with unique id and component fields. Include id root. Reference child IDs; never nest components or create cycles. The host owns catalogId."}],FinalContext),
      put_dict(_{tools:WithTool,context:FinalContext,forwardedProps:Props},ActionInput,Prepared)
    ;put_dict(context,ActionInput,Contexts,Prepared)).
schema_context(E) :- schema_description(D),get_dict(description,E,D).
named_tool(Name,T) :- get_dict(name,T,Name).
action_input(Input,Result) :-
    (get_dict(forwardedProps,Input,F),get_dict(a2uiAction,F,A),get_dict(userAction,A,Action),is_dict(Action)->
      new_id(Call),new_id(M1),new_id(M2),json_text(Action,Args),
      value(Action,name,"unknown_action",Name),value(Action,surfaceId,"unknown_surface",Surface),
      (get_dict(sourceComponentId,Action,Component)->format(string(Part),' (component: ~s)',[Component]);Part=""),
      value(Action,context,_{},Context),json_text(Context,ContextText),
      format(string(Text),'User performed action "~s" on surface "~s"~s. Context: ~s',[Name,Surface,Part,ContextText]),
      value(Input,messages,[],Messages),append(Messages,[
        _{id:M1,role:"assistant",content:"",toolCalls:[_{id:Call,type:"function",function:_{name:"log_a2ui_event",arguments:Args}}]},
        _{id:M2,role:"tool",toolCallId:Call,content:Text}],Updated),put_dict(messages,Input,Updated,Result)
    ;Result=Input).

%! a2ui_accept(+State,+Event,:Emit) is det.
%  Emit complete trees before their completing argument chunk; never paint a partial tree.
a2ui_accept(State,E,Emit) :-
    (E.type=="TOOL_CALL_START" ->
       arg(2,State,Names),
       (memberchk(E.toolCallName,Names)->arg(5,State,Outer),(Outer==none->Key=E.toolCallId;Key=Outer),
         Call=_{args:"",key:Key,painted:false,resolved:false,rejected:false,data_complete:false,count:0},
         arg(3,State,Calls),nb_setarg(3,State,[E.toolCallId-Call|Calls]),activity(State,Key,_{status:"building"},A),call(Emit,A)
       ;E.toolCallName\=="log_a2ui_event"->nb_setarg(5,State,E.toolCallId);true)
    ;E.type=="TOOL_CALL_ARGS" ->
       arg(3,State,Calls),
       (select(E.toolCallId-Call,Calls,Rest)->string_concat(Call.args,E.delta,Args),string_length(Args,N),
         (N>1048576->runtime_error(502,"A2UI arguments exceeded size limit");true),
         put_dict(args,Call,Args,C1),progress(State,C1,C2,Emit),nb_setarg(3,State,[E.toolCallId-C2|Rest]);true)
    ;E.type=="TOOL_CALL_RESULT" ->
       arg(3,State,Calls),
       (select(E.toolCallId-Call,Calls,Rest)->put_dict(resolved,Call,true,Updated),nb_setarg(3,State,[E.toolCallId-Updated|Rest]);true),
       result_activities(State,E,Emit)
    ;true).
result_activities(State,E,Emit) :-
    (catch(atom_json_dict(E.content,Parsed0,[]),_,fail)->
      (string(Parsed0)->catch(atom_json_dict(Parsed0,Parsed,[]),_,Parsed=null);Parsed=Parsed0),
      (is_dict(Parsed),get_dict(a2ui_operations,Parsed,Ops),is_list(Ops)->
        arg(4,State,Painted),exclude(painted_operation(Painted),Ops,New),
        (New\==[]->activity(State,E.toolCallId,_{a2ui_operations:New},A),call(Emit,A);true)
      ;is_dict(Parsed),get_dict(code,Parsed,"a2ui_recovery_exhausted")->
        value(Parsed,error,"A2UI generation failed",Error),value(Parsed,attempts,[],Attempts),length(Attempts,N),
        activity(State,E.toolCallId,_{status:"failed",error:Error,attempts:Attempts,maxAttempts:N},A),call(Emit,A)
      ;true)
    ;true).
painted_operation(Painted,Operation) :- member(Key,[createSurface,updateComponents,updateDataModel,deleteSurface]),
    get_dict(Key,Operation,Body),get_dict(surfaceId,Body,ID),memberchk(ID,Painted).
activity(State,Key,Content,Event) :-
    arg(1,State,Config),
    (get_dict(status,Content,_),get_dict(recovery,Config,Recovery),get_dict(debugExposure,Recovery,Exposure)->put_dict(debugExposure,Content,Exposure,C);C=Content),
    string_concat("a2ui-surface-",Key,ID),Event=_{type:"ACTIVITY_SNAPSHOT",messageId:ID,activityType:"a2ui-surface",content:C,replace:true}.
progress(_,Call,Call,_) :- Call.rejected==true,!.
progress(State,Call,Result,Emit) :-
    (json_field(Call.args,"surfaceId",Surface),string(Surface),Surface\=="",
     json_field(Call.args,"components",Components),is_list(Components)->
      (Call.painted==false -> arg(1,State,Config),validate_components(Config,Components,Errors),
        (Errors\==[] ->value(Config,recovery,_{},Recovery),value(Recovery,maxAttempts,3,Max),
          activity(State,Call.key,_{status:"retrying",attempt:2,maxAttempts:Max,errors:Errors},Activity),call(Emit,Activity),
          put_dict(rejected,Call,true,Painted)
        ;choose_catalog(State,Call.args,Catalog),put_dict(_{painted:true,surface:Surface,components:Components,catalog:Catalog},Call,Painted),
         arg(4,State,Surfaces),nb_setarg(4,State,[Surface|Surfaces]),snapshot(State,Painted,none,A),call(Emit,A))
      ;Painted=Call),
      progressive_data(State,Painted,Result,Emit)
    ;Result=Call).
choose_catalog(State,Args,Catalog) :- arg(1,State,C),arg(6,State,Front),
    (get_dict(defaultCatalogId,C,Configured),string(Configured),Configured\==""->Catalog=Configured
    ;string(Front),Front\==""->Catalog=Front
    ;json_field(Args,"catalogId",Streamed),string(Streamed),Streamed\=="basic",Streamed\==""->Catalog=Streamed
    ;basic_catalog(Catalog)).
progressive_data(_,Call,Call,_) :- (Call.painted==false;Call.data_complete==true),!.
progressive_data(State,Call,Result,Emit) :-
    (json_field(Call.args,"data",Data),is_dict(Data)->snapshot(State,Call,Data,A),call(Emit,A),put_dict(data_complete,Call,true,Result)
    ;data_key(Call.components,Key),partial_array(Call.args,Key,Items),length(Items,N),N>Call.count ->
       dict_create(Data,_,[Key-Items]),snapshot(State,Call,Data,A),call(Emit,A),put_dict(count,Call,N,Result)
    ;Result=Call).
data_key(Components,Key) :-
    (member(C,Components),get_dict(children,C,Children),is_dict(Children),get_dict(path,Children,P),string_concat("/",K,P)->atom_string(Key,K);Key=items).
snapshot(State,Call,Data,Activity) :-
    Ops=[_{version:"v0.9",createSurface:_{surfaceId:Call.surface,catalogId:Call.catalog}},
         _{version:"v0.9",updateComponents:_{surfaceId:Call.surface,components:Call.components}}],
    (Data==none->All=Ops;append(Ops,[_{version:"v0.9",updateDataModel:_{surfaceId:Call.surface,path:"/",value:Data}}],All)),
    activity(State,Call.key,_{a2ui_operations:All},Activity).
a2ui_finish(State,Emit) :- arg(3,State,Calls),forall((member(ID-Call,Calls),Call.resolved==false),
    (new_id(M),json_text(_{status:"rendered"},Content),call(Emit,_{type:"TOOL_CALL_RESULT",messageId:M,toolCallId:ID,content:Content}))).

%! validate_components(+Config,+Components,-Errors) is det.
%  Validate identity, catalog properties, references, and cycles before rendering.
validate_components(Config,Components,Errors) :-
    findall(ID,(member(C,Components),is_dict(C),get_dict(id,C,ID)),IDs),
    findall(Code,component_error(Config,Components,IDs,Code),Codes0),sort(Codes0,Codes),
    findall(_{code:Code,path:"components",message:Code},member(Code,Codes),Errors).
component_error(_,[],_,"empty_components").
component_error(_,_,IDs,"no_root") :- \+memberchk("root",IDs).
component_error(_,_,IDs,"duplicate_id") :- msort(IDs,Sorted),append(_,[X,X|_],Sorted).
component_error(_,Cs,_,"missing_id") :- member(C,Cs),\+ (is_dict(C),get_dict(id,C,ID),string(ID),ID\=="").
component_error(_,Cs,_,"missing_component_type") :- member(C,Cs),\+ (is_dict(C),get_dict(component,C,T),string(T),T\=="").
component_error(Config,Cs,_,"unknown_component") :- catalog(Config,Catalog),member(C,Cs),is_dict(C),get_dict(component,C,T),atom_string(K,T),\+get_dict(K,Catalog,_).
component_error(Config,Cs,_,"missing_required_prop") :- catalog(Config,Catalog),member(C,Cs),is_dict(C),get_dict(component,C,T),atom_string(K,T),get_dict(K,Catalog,Schema),get_dict(required,Schema,Required),member(P,Required),atom_string(Key,P),\+get_dict(Key,C,_).
component_error(Config,Cs,IDs,"unresolved_child") :- member(C,Cs),component_refs(Config,C,Refs),member(Ref,Refs),\+memberchk(Ref,IDs).
component_error(Config,Cs,IDs,"child_cycle") :- member(ID,IDs),cycle(Config,Cs,ID,[]).
catalog(Config,Catalog) :- get_dict(schema,Config,S),get_dict(components,S,Catalog),is_dict(Catalog),dict_pairs(Catalog,_,[_|_]).
component_refs(Config,C,Refs) :-
    findall(Ref,(is_dict(C),(member(K,[child,children]),get_dict(K,C,V),reference(V,Ref)
    ;catalog(Config,Catalog),get_dict(component,C,T),atom_string(Type,T),get_dict(Type,Catalog,Schema),get_dict(properties,Schema,Props),dict_pairs(Props,_,Pairs),member(K-Prop,Pairs),\+memberchk(K,[child,children]),get_dict(K,C,V),schema_ref(Prop,V,Ref))),Refs).
schema_ref(S,V,Ref) :- get_dict(format,S,F),memberchk(F,["componentRef","componentRefList"]),reference(V,Ref).
schema_ref(S,V,Ref) :- get_dict(type,S,"array"),is_list(V),get_dict(items,S,I),get_dict(properties,I,Props),dict_pairs(Props,_,Pairs),member(K-Sub,Pairs),member(Item,V),is_dict(Item),get_dict(K,Item,Value),schema_ref(Sub,Value,Ref).
reference(V,V) :- string(V).
reference(V,Ref) :- is_list(V),member(Item,V),reference(Item,Ref).
reference(V,Ref) :- is_dict(V),get_dict(componentId,V,Ref),string(Ref).
cycle(_,_,ID,Seen) :- memberchk(ID,Seen),!.
cycle(Config,Cs,ID,Seen) :- member(C,Cs),get_dict(id,C,ID),component_refs(Config,C,Refs),member(Child,Refs),cycle(Config,Cs,Child,[ID|Seen]).

%! json_field(+PartialJSON,+Name,-Value) is semidet.
%  Scan lexical strings so quoted JSON inside a value cannot masquerade as a key.
json_field(Text,Name,Value) :- field_codes(Text,Name,Codes),phrase(json_value(Token),Codes,_),string_codes(S,Token),catch(atom_json_dict(S,Value,[]),_,fail).
field_codes(Text,Name,Codes) :- string_codes(Text,All),(atom(Name)->atom_string(Name,N);N=Name),scan_field(All,N,Codes).
scan_field([34|Rest],Name,Value) :- !,
    phrase(json_string(Token),[34|Rest],After),string_codes(Text,Token),catch(atom_json_dict(Text,Key,[]),_,fail),
    phrase(blanks,After,Spaced),
    (Key==Name,Spaced=[58|Tail]->phrase(blanks,Tail,Value);scan_field(After,Name,Value)).
scan_field([_|Rest],Name,Value) :- scan_field(Rest,Name,Value).
json_string([34|Rest]) --> [34],quoted(Rest).
quoted([34]) --> [34],!.
quoted([92,C|Rest]) --> [92,C],!,quoted(Rest).
quoted([C|Rest]) --> [C],{C\==34},quoted(Rest).
json_value(Token) --> json_string(Token),!.
json_value([123|Rest]) --> [123],balanced(125,Rest),!.
json_value([91|Rest]) --> [91],balanced(93,Rest),!.
json_value([C|Rest]) --> [C],{\+memberchk(C,[32,10,13,9,44,93,125])},scalar_tail(Rest).
scalar_tail([]),[C] --> [C],{memberchk(C,[32,10,13,9,44,93,125])},!.
scalar_tail([C|Rest]) --> [C],scalar_tail(Rest).
balanced(End,[End]) --> [End],!.
balanced(End,Token) --> json_string(S),!,balanced(End,R),{append(S,R,Token)}.
balanced(End,[123|Rest]) --> [123],!,balanced(125,Inner),balanced(End,Tail),{append(Inner,Tail,Rest)}.
balanced(End,[91|Rest]) --> [91],!,balanced(93,Inner),balanced(End,Tail),{append(Inner,Tail,Rest)}.
balanced(End,[C|Rest]) --> [C],balanced(End,Rest).
partial_array(Text,Name,Items) :- field_codes(Text,Name,[91|Codes]),array_prefix(Codes,Items).
array_prefix(Codes,Items) :- phrase(blanks,Codes,Rest),
    (Rest=[44|Tail]->array_prefix(Tail,Items)
    ;phrase(json_value(Token),Rest,After),string_codes(S,Token),catch(atom_json_dict(S,V,[]),_,fail)->Items=[V|More],array_prefix(After,More)
    ;Items=[]).
