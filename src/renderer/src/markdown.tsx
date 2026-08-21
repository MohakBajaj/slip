const blocksRe = /\n{2,}/u;
const bulletPrefix = /^- /u;

export const Markdown = ({ text }: { text: string }) => {
  const blocks = text.split(blocksRe);
  return (
    <div className="md">
      {blocks.map((block, index) => {
        const key = `${index}:${block.slice(0, 24)}`;
        if (block.startsWith("# ")) {
          return <h1 key={key}>{block.slice(2)}</h1>;
        }
        if (block.startsWith("## ")) {
          return <h2 key={key}>{block.slice(3)}</h2>;
        }
        if (block.startsWith("- ")) {
          return (
            <ul key={key}>
              {block.split("\n").map((line) => (
                <li key={line}>{line.replace(bulletPrefix, "")}</li>
              ))}
            </ul>
          );
        }
        return <p key={key}>{block}</p>;
      })}
    </div>
  );
};
