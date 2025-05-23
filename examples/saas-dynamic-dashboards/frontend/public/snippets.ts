export const codeSnippets = [
    'let x=0;\nlet y=[];\nfor(let i=0;i<10;i++){\n  x+=i*2;\n  if(x>20){\n    y.push(x);\n    break;\n  }\n  y.push(i);\n}\nconsole.log(x,y);\nreturn y.length;',
    
    'const arr=[1,2,3,4,5];\nlet result=[];\narr.map(x=>x*2)\n  .filter(x=>x>5)\n  .forEach(x=>{\n    if(x%2===0){\n      result.push(x);\n    } else {\n      result.push(x*3);\n    }\n  });\nconsole.log(result);\nreturn result.reduce((a,b)=>a+b,0);',
    
    'let obj={a:1,b:2};\nlet keys=Object.keys(obj);\nlet values=[];\nkeys.forEach(k=>{\n  obj[k]*=2;\n  values.push(obj[k]);\n  if(obj[k]>5){\n    obj[k]=0;\n  }\n});\nconsole.log(obj,values);\nreturn values.length;',
    
    'const fn=x=>{\n  let y=x;\n  let result=[];\n  while(y>0){\n    y--;\n    if(y%2===0){\n      result.push(y*2);\n      continue;\n    }\n    result.push(y);\n  }\n  console.log(result);\n  return result.filter(x=>x>5);\n};\nfn(10);',
    
    'let str="";\nlet arr=[];\nfor(let i=0;i<5;i++){\n  str+=String.fromCharCode(65+i);\n  arr.push(str);\n  if(i%2===0){\n    str=str.toLowerCase();\n  } else {\n    str=str.toUpperCase();\n  }\n}\nconsole.log(str,arr);\nreturn arr.join("");',
    
    'const nums=[1,2,3,4,5];\nlet sum=0;\nlet result=[];\nnums.forEach(n=>{\n  if(n%2===0){\n    sum+=n*n;\n    result.push(sum);\n  } else {\n    sum+=n;\n    result.push(sum*2);\n  }\n});\nconsole.log(sum,result);\nreturn result.reduce((a,b)=>a+b,0);',
    
    'let x=10;\nlet arr=[];\ndo{\n  x--;\n  if(x===5){\n    arr.push(x*2);\n    break;\n  }\n  arr.push(x);\n  if(x%2===0){\n    arr.push(x*x);\n  }\n}while(x>0);\nconsole.log(x,arr);\nreturn arr.length;',
    
    'const arr=Array(5);\nlet result=[];\narr.fill(0)\n  .map((_,i)=>i*i)\n  .filter(x=>x>5)\n  .forEach(x=>{\n    result.push(x);\n    if(x%2===0){\n      result.push(x/2);\n    }\n  });\nconsole.log(result);\nreturn result.reduce((a,b)=>a+b,0);',
    
    'let obj={};\nlet keys=[];\nlet values=[];\nfor(let i=0;i<3;i++){\n  obj[`key${i}`]=i*i;\n  keys.push(`key${i}`);\n  values.push(i*i);\n  if(i%2===0){\n    obj[`key${i}`]=i*i*i;\n  }\n}\nconsole.log(obj,keys,values);\nreturn Object.values(obj);',
    
    'const fn=(x,y)=>{\n  let result=[];\n  if(x>y){\n    result.push(x*2);\n    result.push(y*3);\n  } else {\n    result.push(y*2);\n    result.push(x*3);\n  }\n  console.log(result);\n  return result.reduce((a,b)=>a+b,0);\n};\nfn(5,3);\nfn(2,4);'
];
