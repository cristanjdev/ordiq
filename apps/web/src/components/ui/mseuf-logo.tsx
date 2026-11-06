import * as React from "react";
import { OrdiqLogo, type OrdiqLogoProps } from "./ordiq-logo";

export type MseufLogoProps = OrdiqLogoProps;

export function MseufLogo(props: MseufLogoProps) {
  return <OrdiqLogo {...props} />;
}
