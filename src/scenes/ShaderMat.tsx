// A ShaderMaterial that keeps the exact uniforms object it is given.
// <shaderMaterial uniforms={...}> in React Three Fiber copies the object, so
// later writes to our uniforms (time, throttle, camera altitude) never reach
// the GPU. Building the material ourselves avoids that.

import { forwardRef, useEffect, useImperativeHandle, useMemo } from "react";
import * as THREE from "three";

type Props = THREE.ShaderMaterialParameters;

const ShaderMat = forwardRef<THREE.ShaderMaterial, Props>(function ShaderMat(props, ref) {
  const { vertexShader, fragmentShader, uniforms, defines, ...rest } = props;
  const mat = useMemo(
    () => new THREE.ShaderMaterial({ vertexShader, fragmentShader, uniforms, defines, ...rest }),
    // Rebuild only when the program or its uniforms change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [vertexShader, fragmentShader, uniforms, defines],
  );
  useEffect(() => {
    mat.setValues(rest);
  });
  useImperativeHandle(ref, () => mat, [mat]);
  useEffect(() => () => mat.dispose(), [mat]);
  return <primitive object={mat} attach="material" />;
});

export default ShaderMat;
