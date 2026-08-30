import { Fragment } from "react";
import { Alert } from "@/components/ui/Alert";
import type { DocBlock } from "@/lib/docs";
import { AnnotatedShot } from "./AnnotatedShot";
import styles from "./DocBlocks.module.scss";

/**
 * Chữ đậm viết dạng `**tên nút**` ngay trong dữ liệu bài — đủ để làm nổi tên
 * nút, tên ô trong câu hướng dẫn. Không kéo thư viện markdown vào chỉ vì một
 * kiểu nhấn duy nhất.
 */
function renderInline(text: string): React.ReactNode {
  const parts = text.split("**");
  if (parts.length < 3) return text;
  return parts.map((part, i) =>
    i % 2 === 1 ? <strong key={i}>{part}</strong> : <Fragment key={i}>{part}</Fragment>,
  );
}

/** Thân một bài hướng dẫn — dựng lần lượt từng khối theo dữ liệu. */
export function DocBlocks({ blocks }: { blocks: DocBlock[] }) {
  return (
    <div className={styles.blocks}>
      {blocks.map((block, i) => {
        switch (block.kind) {
          case "text":
            return (
              <p key={i} className={styles.text}>
                {renderInline(block.body)}
              </p>
            );
          case "steps":
            return (
              <ol key={i} className={styles.steps}>
                {block.items.map((item, j) => (
                  <li key={j}>{renderInline(item)}</li>
                ))}
              </ol>
            );
          case "note":
            return (
              <Alert key={i} tone={block.tone}>
                {renderInline(block.body)}
              </Alert>
            );
          case "shot":
            return <AnnotatedShot key={i} shot={block.shot} />;
        }
      })}
    </div>
  );
}
