import React from "react";
import { Composition } from "remotion";
import { BridgeShort, BRIDGE_FRAMES } from "./videos/bridge/Bridge";
import { VasaShort, VASA_FRAMES } from "./videos/vasa/Vasa";

export const Root: React.FC = () => (
  <>
    <Composition id="VasaShort" component={VasaShort} durationInFrames={VASA_FRAMES} fps={30} width={1080} height={1920} />
    <Composition id="BridgeShort" component={BridgeShort} durationInFrames={BRIDGE_FRAMES} fps={30} width={1080} height={1920} />
  </>
);
