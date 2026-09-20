import * as React from "react";
import { useTranslation } from "react-i18next";
import styled from "styled-components";
import { s } from "@shared/styles";
import Flex from "~/components/Flex";

interface Props {
  /** Whether the empty state is caused by an active filter (vs. truly no rows). */
  hasFilter: boolean;
}

/**
 * Shown in place of a database view's row list when no rows exist. Renders
 * a brief explanation so users understand the view is empty — not broken.
 */
export default function DatabaseEmptyState({ hasFilter }: Props) {
  const { t } = useTranslation();

  return (
    <Container direction="column" align="center" justify="center" gap={8}>
      <Heading>
        {hasFilter ? t("No matching rows") : t("No rows yet")}
      </Heading>
      <Body>
        {hasFilter
          ? t("Try adjusting or clearing the active filter.")
          : t("Add a row to get started.")}
      </Body>
    </Container>
  );
}

const Container = styled(Flex)`
  padding: 32px 16px;
  text-align: center;
`;

const Heading = styled.p`
  margin: 0;
  font-size: 15px;
  font-weight: 500;
  color: ${s("textSecondary")};
`;

const Body = styled.p`
  margin: 0;
  font-size: 13px;
  color: ${s("textTertiary")};
`;
