# FundaStream
This is react based website that is similar to youtube.

# Tools:
-RapidApi for the back-end APIs that i used https://rapidapi.com

-Mui5 components that was very helpful https://mui.com the documention is superb btw

-Custom Css 

# Running this project 
Delete the package-lock.json, try to update the dependencies to latest version to work properly using:
```
npm install
```
Then run:
```
npm run start
```
# Notes:
This is project is not fully customized to be like youtube or any other streaming site, it just to develop some basic features

You can find more on this by reading the RapidApi lists of thousands of helpful API that I recommend, you can find to this site at least 35 or more API, comparing to the 8 API I used here.

The MUI components need a lot of reading in the docs provided in their site, and you should find the accurate one to use, don't miss if you are using create-reacta-app(legacy) to create vite@latest because the libs are not the same, you can find in array displaying components don't work i.e : 

const categoriers =[
{name:'coding' , icon :<CodingIcon/>}, // this will not work in vite.js cause  you need to either distructre it in typescript(hard but good) or implement one by one incase you want to map over this array , final solution use create-react-app
{...................................},
] 
etc.....
