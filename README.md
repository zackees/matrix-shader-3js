# matrix-shader-3js

This code repository contains a manual port of a ShaderToy.com to three.js
  
What's the big deal? ShaderToy provides an easy to use environment for writing shaders. The
environment is made simple by the inclusion of automatically declared variables that the
program passes information like example iChannel, iTime, iResolution. Therefore porting this
code relies on explicitly declaring these variables and a main() function that calls into
the appropriate code.
  
This file contains the minimal boilerplate and minimal tweaking to make this transition:

  * ShaderToy [link](https://www.shadertoy.com/view/ldccW4)
  * Demo [html](https://zackees.github.io/matrix-shader-3js/)

  
