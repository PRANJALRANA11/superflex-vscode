import React, { useContext, useState } from 'react';
import hljs from 'highlight.js';
import 'highlight.js/styles/vs2015.css';
import styled from 'styled-components';
import ReactMarkdown from 'react-markdown';
import Editor from 'react-simple-code-editor';
import CopyToClipboard from 'react-copy-to-clipboard';
import { DocumentDuplicateIcon, DocumentCheckIcon } from '@heroicons/react/24/outline';

import { cn } from '../../common/utils';
import { VscThemeContext } from '../../context/VscTheme';
import { Button } from './Button';
import { FileIcon } from './FileIcon';

const StyledPre = styled.pre<{ theme: Record<string, string> }>`
  & .hljs {
    color: var(--vscode-editor-foreground);
  }

  margin-top: 0;
  margin-bottom: 0;
  border-radius: 0 0 5px 5px !important;

  ${({ theme }) =>
    Object.entries(theme)
      .map(([key, value]) => `& ${key} { color: ${value}; }`)
      .join('\n')}
`;

interface SyntaxHighlightedPreProps extends React.HTMLAttributes<HTMLPreElement> {
  className?: string;
}

export const SyntaxHighlightedPre: React.FC<SyntaxHighlightedPreProps> = ({ className, ...props }) => {
  const currentTheme = useContext(VscThemeContext);

  return <StyledPre className={className} theme={currentTheme} {...props} />;
};

interface MarkdownRenderProps {
  mdString: string;
}

export const MarkdownRender: React.FunctionComponent<MarkdownRenderProps> = ({ mdString }) => {
  const [copyTip, setCopyTip] = useState('Copy code');

  return (
    <ReactMarkdown
      className="prose prose-sm text-sm dark:prose-invert"
      components={{
        code({ inline, className, ...props }: any) {
          const hasLang = /language-(\w+)/.exec(className || '');
          const codeProp = String(props.children).replace(/\n$/, '');
          const infoProp = String(mdString).replace(/\n$/, '');
          let fileName = null;
          let startLine = null;
          let endLine = null;
          const lines = infoProp.split('\n');

          for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes('file=')) {
              const fileMatch = lines[i].match(/file="([^"]+)"/);
              if (fileMatch) {
                const fileInfo = fileMatch[1];
                if (fileInfo.includes('#')) {
                  const [filePath, lineNumbers] = fileInfo.split('#');
                  fileName = filePath;
                  if (lineNumbers && lineNumbers.includes('-')) {
                    const [start, end] = lineNumbers.split('-');
                    startLine = parseInt(start);
                    endLine = parseInt(end);
                  }
                } else {
                  fileName = fileInfo;
                }
                lines.splice(i, 1);
                break;
              }
            }
          }

          const cleanedCode = codeProp
            .replace(/<superflex_domain_knowledge>\n?/, '')
            .replace(/\n?<\/superflex_domain_knowledge>/, '')
            .trim();

          return !inline && hasLang ? (
            <div className="rounded-xl ml-2 mr-2  border-gray-600 border-[1px] bg-background max-h-64 overflow-y-auto mt-4">
              <div className="flex gap-1 pt-2 pl-2 border-gray-600 border-b-[1px]">
                <FileIcon filename={fileName ?? 'main.js'} className="size-5" />
                <p className="text-xm text-foreground truncate max-w-36">{fileName ?? 'main.js'}</p>
                {startLine && endLine && (
                  <p className="text-xs text-foreground truncate max-w-36">{`(${startLine}-${endLine})`}</p>
                )}
                <div className="ml-44">
                  <CopyToClipboard
                    text={codeProp}
                    onCopy={async () => {
                      setCopyTip('Copied');
                      await new Promise((resolve) => setTimeout(resolve, 5000));
                      setCopyTip('Copy code');
                      // Keeps the tooltip open after copying
                    }}>
                    {copyTip === 'Copied' ? (
                      <DocumentCheckIcon className="h-4 w-4 text-muted-foreground hover:text-foreground" />
                    ) : (
                      <Button size="xs" variant="text" className="p-0">
                        <DocumentDuplicateIcon className="h-4 w-4 text-muted-foreground hover:text-foreground" />
                      </Button>
                    )}
                  </CopyToClipboard>
                </div>
              </div>

              <Editor
                value={cleanedCode}
                onValueChange={(code) => console.log('not editable')}
                highlight={(code) => (
                  <SyntaxHighlightedPre>
                    <div dangerouslySetInnerHTML={{ __html: hljs.highlightAuto(code).value }} />
                  </SyntaxHighlightedPre>
                )}
                padding={10}
                style={{
                  fontFamily: '"Fira code", "Fira Mono", monospace',
                  fontSize: 12
                }}
              />
            </div>
          ) : (
            <code className={cn('text-sm', className)} {...props} />
          );
        }
      }}>
      {mdString}
    </ReactMarkdown>
  );
};
