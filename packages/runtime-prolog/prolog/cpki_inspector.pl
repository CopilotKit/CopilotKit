:- module(cpki_inspector,[inspector_metadata/2]).
:- use_module(library(uri)).
:- use_module(library(pcre)).

%! inspector_metadata(+Untrusted,-Metadata) is semidet.
%  Copy supported V1 display fields. These fields never grant resource access.
inspector_metadata(Value,Metadata) :-
    is_dict(Value),get_dict(schemaVersion,Value,Version),number(Version),Version=:=1,
    findall(Key-Module,(member(Key,[identity,plan,license,action,usage]),get_dict(Key,Value,Raw),
      is_dict(Raw),parse_module(Key,Raw,Module)),Pairs),dict_create(Metadata,_,[schemaVersion-1|Pairs]).
parse_module(identity,V,_{organizationName:Org,projectName:Project}) :-
    get_dict(organizationName,V,O),text(O,Org),get_dict(projectName,V,P),text(P,Project).
parse_module(plan,V,_{code:Code,label:Label}) :- get_dict(code,V,C),text(C,Code),get_dict(label,V,L),text(L,Label).
parse_module(license,V,_{state:State}) :- get_dict(state,V,State),memberchk(State,["valid","none","expired","unknown"]).
parse_module(action,V,_{kind:Kind,url:URL}) :- get_dict(kind,V,Kind),memberchk(Kind,["manage_plan","renew","enable_intelligence"]),
    get_dict(url,V,Raw),safe_url(Raw,URL).
parse_module(usage,V,Usage) :- get_dict(used,V,U),safe_integer(U,0,Used),get_dict(limit,V,L),is_dict(L),limit(L,Limit),
    Base=_{used:Used,limit:Limit},
    (get_dict(expiringSoonCount,V,E),safe_integer(E,0,N)->put_dict(expiringSoonCount,Base,N,Usage);Usage=Base).
limit(V,_{kind:"finite",value:N}) :- get_dict(kind,V,"finite"),get_dict(value,V,Raw),safe_integer(Raw,1,N).
limit(V,_{kind:Kind}) :- get_dict(kind,V,Kind),memberchk(Kind,["unlimited","unknown"]).
safe_integer(Raw,Minimum,N) :- number(Raw),catch((Raw>=Minimum,Raw=<9007199254740991,N is floor(Raw),Raw=:=N),_,fail).
text(Raw,Text) :- string(Raw),
    re_replace('^[\\x{0009}-\\x{000D}\\x{0020}\\x{00A0}\\x{1680}\\x{2000}-\\x{200A}\\x{2028}\\x{2029}\\x{202F}\\x{205F}\\x{3000}\\x{FEFF}]+|[\\x{0009}-\\x{000D}\\x{0020}\\x{00A0}\\x{1680}\\x{2000}-\\x{200A}\\x{2028}\\x{2029}\\x{202F}\\x{205F}\\x{3000}\\x{FEFF}]+$'/g,"",Raw,Text),Text\=="".
safe_url(Raw,URL) :- text(Raw,URL),\+re_match('[?#\\\\\\x00-\\x20]',URL),
    catch((uri_components(URL,C),uri_data(scheme,C,Scheme),memberchk(Scheme,[http,https]),
      uri_data(authority,C,Authority),atom(Authority),Authority\=='',\+sub_atom(Authority,_,_,_,'@'),
      authority_host_port(Authority,Host,Port),Host\=='',
      \+re_match('[%#/<>?@\\\\^|\\x00-\\x20]',Host),
      (var(Port)->true;integer(Port),between(0,65535,Port)),
      (Scheme==https->true;downcase_atom(Host,Lower),memberchk(Lower,[localhost,'127.0.0.1','::1','[::1]']))),_,fail).

% SWI 9.0 URI authority parsing predates bracketed IPv6 host support.
authority_host_port(Authority,Host,Port) :-
    (sub_atom(Authority,0,1,_,'[')->
      re_matchsub('^\\[([0-9a-fA-F:]+)\\](?::([0-9]+))?$',Authority,Parts,[]),
      atom_string(Host,Parts.1),
      (get_dict(2,Parts,PortText),PortText\==""->number_string(Port,PortText);true)
    ;uri_authority_components(Authority,A),uri_authority_data(host,A,Host),uri_authority_data(port,A,Port)).
